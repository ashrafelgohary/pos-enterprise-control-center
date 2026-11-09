"""Central configuration. Every secret comes from environment variables / Docker secrets."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # --- Application ---------------------------------------------------------
    app_name: str = "POS Control Center"
    environment: str = "production"  # production | staging | development
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"
    allowed_hosts: list[str] = ["*"]

    # --- Security ------------------------------------------------------------
    secret_key: str = Field(..., min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 60
    cookie_secure: bool = True          # set False only for plain-HTTP lab use
    cookie_domain: str | None = None
    login_rate_limit_per_minute: int = 10      # per client IP
    login_max_failures: int = 5                # per username ...
    login_lockout_minutes: int = 15            # ... within this window
    password_min_length: int = 10

    # --- Database / broker ---------------------------------------------------
    database_url: str = Field(..., description="postgresql+psycopg://user:pass@host:5432/db")
    redis_url: str = "redis://redis:6379/0"

    # --- Uploads -------------------------------------------------------------
    upload_dir: Path = Path("/data/uploads")
    max_xml_size_mb: int = 5
    max_files_per_upload: int = 200
    # Element / attribute names searched in XML content to identify the POS
    xml_hostname_tags: list[str] = ["Hostname", "HostName", "PosName", "PosId", "TerminalId", "DeviceName"]

    # --- Ansible integration -------------------------------------------------
    ansible_project_dir: Path = Path("/ansible")      # your existing project (mounted read-only)
    ansible_playbook: str = "site.yml"                # relative to ansible_project_dir
    ansible_runs_dir: Path = Path("/data/runs")
    ansible_inventory_group: str = "pos"
    ansible_forks: int = 20
    ansible_timeout_seconds: int = 1800
    ansible_host_key_checking: bool = False
    ansible_verbosity: int = 0
    # auth mode: "password" mirrors `-k -K`; "key" uses a private key file
    ansible_auth_mode: str = "password"
    ansible_user: str | None = None
    ansible_ssh_password_file: Path = Path("/run/secrets/ansible_ssh_password")
    ansible_become_password_file: Path = Path("/run/secrets/ansible_become_password")
    ansible_ssh_key_file: Path = Path("/run/secrets/ansible_ssh_key")
    ansible_vault_password_file: Path = Path("/run/secrets/ansible_vault_password")
    # Extra static vars passed to every run (JSON object)
    ansible_extra_vars: dict = {}
    # Alias platform variable names to the names your playbook already uses (JSON object)
    # e.g. {"xml_src_path": "pos_xml_src"}
    ansible_var_map: dict[str, str] = {}
    # Optional staging hook (mirrors scripts/stage_pos_xmls.py). When set, each XML is copied to this
    # path before the run and that path is passed as xml_src_path. Placeholders: {hostname} {filename}
    # e.g. "/ansible-staging/{hostname}/{filename}"   (leave empty to pass the upload path directly)
    ansible_stage_path_template: str = ""
    keep_run_artifacts_days: int = 30

    # --- POS health checks ---------------------------------------------------
    health_check_enabled: bool = True
    health_check_interval_seconds: int = 120
    health_check_port: int = 22
    health_check_timeout_seconds: float = 2.0
    health_check_workers: int = 64

    # --- Keycloak / OIDC single sign-on -------------------------------------
    oidc_enabled: bool = False
    oidc_issuer: str = ""                      # https://keycloak.example/realms/alshaya
    oidc_client_id: str = "pos-control-center"
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = ""                # empty = derived from request
    oidc_post_logout_redirect_uri: str = ""    # e.g. http://192.168.44.129:8080/login
    oidc_scopes: str = "openid profile email"
    oidc_username_claim: str = "preferred_username"
    oidc_groups_claim: str = "groups"
    oidc_admin_groups: list[str] = ["pos-admins"]
    oidc_operator_groups: list[str] = ["pos-operators"]
    oidc_viewer_groups: list[str] = ["pos-viewers"]
    oidc_default_role: str = ""                # "" = deny users without a mapped group
    oidc_sync_role: bool = True                # role follows Keycloak groups on every login
    oidc_verify_tls: bool = True
    oidc_ca_file: str = ""
    oidc_email_fallback_domain: str = "alshaya.local"
    oidc_button_label: str = "Sign in with Alshaya SSO"
    local_login_enabled: bool = True           # keep local admin as break-glass

    # --- Bootstrap admin -----------------------------------------------------
    initial_admin_username: str = "admin"
    initial_admin_email: str = "admin@example.local"
    initial_admin_password: str | None = None

    @field_validator("ansible_extra_vars", "ansible_var_map", mode="before")
    @classmethod
    def _parse_json(cls, v):
        if isinstance(v, str):
            return json.loads(v.strip() or "{}")
        return v

    @field_validator("ansible_auth_mode")
    @classmethod
    def _auth_mode(cls, v: str) -> str:
        if v not in {"password", "key"}:
            raise ValueError("ANSIBLE_AUTH_MODE must be 'password' or 'key'")
        return v

    @property
    def is_dev(self) -> bool:
        return self.environment == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
