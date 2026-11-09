"""Ansible integration layer.

This module is the ONLY place that talks to Ansible. It wraps your existing playbook with
ansible-runner (Python API, no shell): it builds a per-run private data dir, a generated inventory
containing only validated hosts from the database, passes variables as data (never interpolated
into a command line) and streams per-host events back to the caller.

Your playbook/roles live in ANSIBLE_PROJECT_DIR (mounted read-only) and are not modified.
"""
from __future__ import annotations

import json
import logging
import shutil
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import settings

log = logging.getLogger(__name__)
MAX_HOST_OUTPUT = 128 * 1024


@dataclass
class DeploymentTarget:
    result_id: int
    pos_id: int | None
    hostname: str
    ip_address: str
    xml_path: str
    xml_filename: str
    store_name: str | None = None
    brand: str | None = None


@dataclass
class HostOutcome:
    ok: bool
    output: str
    error: str | None


@dataclass
class RunOutcome:
    run_id: str
    status: str               # successful | failed | timeout | canceled | error
    rc: int | None
    hosts: dict[str, HostOutcome] = field(default_factory=dict)
    fatal_error: str | None = None


class AnsibleConfigError(RuntimeError):
    pass


def _read_secret(path: Path) -> str | None:
    try:
        return path.read_text().rstrip("\n") if path.is_file() else None
    except OSError:
        return None


class AnsibleService:
    def __init__(self) -> None:
        self.project_dir = settings.ansible_project_dir.resolve()
        self.playbook = settings.ansible_playbook

    # ------------------------------------------------------------------ checks
    def preflight(self) -> None:
        pb = (self.project_dir / self.playbook).resolve()
        if self.project_dir not in pb.parents or not pb.is_file():
            raise AnsibleConfigError(f"Playbook not found: {self.playbook} in {self.project_dir}")
        if settings.ansible_auth_mode == "password" and not _read_secret(settings.ansible_ssh_password_file):
            raise AnsibleConfigError("ANSIBLE_AUTH_MODE=password but SSH password secret is missing")
        if settings.ansible_auth_mode == "key" and not settings.ansible_ssh_key_file.is_file():
            raise AnsibleConfigError("ANSIBLE_AUTH_MODE=key but SSH key secret is missing")

    # --------------------------------------------------------------- inventory
    def _host_vars(self, t: DeploymentTarget) -> dict:
        v = {
            "ansible_host": t.ip_address,
            "pos_hostname": t.hostname,
            "pos_ip": t.ip_address,
            "pos_id": t.pos_id,
            "pos_store": t.store_name,
            "pos_brand": t.brand,
            "target_pos": t.hostname,
            "xml_src_path": t.xml_path,
            "xml_filename": t.xml_filename,
        }
        # Alias platform variable names to the names your playbook already expects
        for src, dst in settings.ansible_var_map.items():
            if src in v:
                v[dst] = v[src]
        return v

    def _build_private_dir(self, job_id: int, targets: list[DeploymentTarget]) -> tuple[str, Path]:
        run_id = f"{job_id}-{uuid.uuid4().hex[:8]}"
        pdd = (settings.ansible_runs_dir / str(job_id) / run_id).resolve()
        (pdd / "inventory").mkdir(parents=True, mode=0o750)
        (pdd / "env").mkdir(mode=0o750)

        group = settings.ansible_inventory_group
        group_vars: dict = {}
        if settings.ansible_user:
            group_vars["ansible_user"] = settings.ansible_user
        if settings.ansible_auth_mode == "key":
            group_vars["ansible_ssh_private_key_file"] = str(settings.ansible_ssh_key_file)
        if settings.ansible_auth_mode == "password":
            become_file = (settings.ansible_become_password_file
                           if _read_secret(settings.ansible_become_password_file)
                           else settings.ansible_ssh_password_file)
            group_vars["ansible_password"] = "{{ lookup('file', '%s') }}" % settings.ansible_ssh_password_file
            group_vars["ansible_become_password"] = "{{ lookup('file', '%s') }}" % become_file
        inventory = {"all": {"children": {group: {
            "hosts": {t.hostname: self._host_vars(t) for t in targets},
            "vars": group_vars,
        }}}}
        # JSON is valid YAML; avoids a YAML dependency and any templating of user data
        (pdd / "inventory" / "hosts.yml").write_text(json.dumps(inventory, indent=2))

        # Re-use group_vars / host_vars that ship with your existing inventory (vault files included)
        for sub in ("group_vars", "host_vars"):
            src = self.project_dir / "inventory" / sub
            if src.is_dir():
                (pdd / "inventory" / sub).symlink_to(src, target_is_directory=True)
        return run_id, pdd

    # --------------------------------------------------------------------- run
    def run(
        self,
        job_id: int,
        targets: list[DeploymentTarget],
        on_host_started: Callable[[str], None] | None = None,
        on_host_failed: Callable[[str, str], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> RunOutcome:
        import ansible_runner  # imported lazily: only the worker image ships Ansible

        self.preflight()
        run_id, pdd = self._build_private_dir(job_id, targets)
        names = {t.hostname for t in targets}
        buffers: dict[str, list[str]] = {h: [] for h in names}
        sizes: dict[str, int] = {h: 0 for h in names}
        errors: dict[str, str] = {}
        started: set[str] = set()
        stats: dict = {}

        def append(host: str, text: str) -> None:
            if host in buffers and text and sizes[host] < MAX_HOST_OUTPUT:
                buffers[host].append(text)
                sizes[host] += len(text)

        def event_handler(ev: dict) -> bool:
            et = ev.get("event", "")
            data = ev.get("event_data", {}) or {}
            host = data.get("host") or data.get("remote_addr")
            stdout = ev.get("stdout", "")
            if et == "playbook_on_stats":
                stats.update({k: data.get(k, {}) for k in ("ok", "failures", "dark", "changed", "skipped", "processed", "ignored", "rescued")})
                return True
            if not host or host not in buffers:
                return True
            if et == "runner_on_start" and host not in started:
                started.add(host)
                if on_host_started:
                    on_host_started(host)
            append(host, stdout + "\n" if stdout else "")
            if et in ("runner_on_failed", "runner_on_unreachable") and not data.get("ignore_errors"):
                res = data.get("res", {}) or {}
                msg = res.get("msg") or res.get("stderr") or res.get("module_stderr") or et
                task = data.get("task", "")
                errors.setdefault(host, f"[{task}] {str(msg)[:2000]}")
                if on_host_failed:
                    on_host_failed(host, errors[host])
            return True

        passwords: dict[str, str] = {}
        cmdline: list[str] = []
        if settings.ansible_vault_password_file.is_file() and _read_secret(settings.ansible_vault_password_file):
            cmdline += ["--vault-password-file", str(settings.ansible_vault_password_file)]

        envvars = {
            "ANSIBLE_HOST_KEY_CHECKING": "True" if settings.ansible_host_key_checking else "False",
            "ANSIBLE_RETRY_FILES_ENABLED": "False",
            "ANSIBLE_NOCOLOR": "True",
            "ANSIBLE_FORCE_COLOR": "False",
            "ANSIBLE_ROLES_PATH": str(self.project_dir / "roles"),
        }
        extravars = {"poscc_job_id": job_id, "poscc_run_id": run_id, **settings.ansible_extra_vars}

        log.info("ansible run %s starting: %d hosts", run_id, len(targets))
        t0 = time.monotonic()
        try:
            r = ansible_runner.run(
                private_data_dir=str(pdd),
                project_dir=str(self.project_dir),
                playbook=self.playbook,
                inventory=str(pdd / "inventory" / "hosts.yml"),
                limit=",".join(sorted(names)),
                forks=min(settings.ansible_forks, max(1, len(targets))),
                extravars=extravars,
                envvars=envvars,
                passwords=passwords,
                cmdline=" ".join(cmdline) if cmdline else None,
                verbosity=settings.ansible_verbosity or None,
                timeout=settings.ansible_timeout_seconds,
                event_handler=event_handler,
                cancel_callback=(lambda: bool(should_cancel and should_cancel())),
                quiet=True,
                json_mode=False,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("ansible-runner crashed")
            return RunOutcome(run_id, "error", None, fatal_error=f"Ansible runner error: {exc}")

        log.info("ansible run %s finished status=%s rc=%s in %.1fs", run_id, r.status, r.rc, time.monotonic() - t0)
        failures, dark, processed = stats.get("failures", {}), stats.get("dark", {}), stats.get("processed", {})

        outcome = RunOutcome(run_id, r.status, r.rc)
        for h in names:
            out = "".join(buffers[h])
            if r.status == "canceled":
                outcome.hosts[h] = HostOutcome(False, out, "Cancelled by user")
            elif h in failures or h in dark:
                outcome.hosts[h] = HostOutcome(False, out, errors.get(h) or ("Host unreachable" if h in dark else "Task failed"))
            elif h in processed:
                outcome.hosts[h] = HostOutcome(True, out, None)
            else:
                reason = errors.get(h)
                if not reason:
                    reason = ("Timed out" if r.status == "timeout" else
                              "Host was not processed - check the play's 'hosts:' pattern matches the "
                              f"'{settings.ansible_inventory_group}' group, or see run output.")
                    if r.status == "failed" and not stats:
                        reason = "Playbook failed before reaching the host:\n" + _tail(r)
                outcome.hosts[h] = HostOutcome(False, out, reason)
        return outcome

    @staticmethod
    def cleanup_old_runs(days: int) -> int:
        cutoff = time.time() - days * 86400
        removed = 0
        base = settings.ansible_runs_dir
        if not base.is_dir():
            return 0
        for job_dir in base.iterdir():
            if job_dir.is_dir() and job_dir.stat().st_mtime < cutoff:
                shutil.rmtree(job_dir, ignore_errors=True)
                removed += 1
        return removed


def _tail(r, n: int = 4000) -> str:
    try:
        return r.stdout.read()[-n:]
    except Exception:  # noqa: BLE001
        return "(no output)"
