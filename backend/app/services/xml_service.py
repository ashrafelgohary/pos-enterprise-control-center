"""XML upload validation, safe storage and POS matching.

Security:
  * filename whitelist regex -> no path separators, no '..', no hidden files
  * files stored under <upload_dir>/<batch uuid>/<sanitised name>; final path is resolved
    and verified to stay inside upload_dir (defence in depth against traversal)
  * parsing via defusedxml (blocks XXE, entity expansion / billion laughs, external DTDs)
  * size limit enforced while streaming
"""
from __future__ import annotations

import hashlib
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from defusedxml import ElementTree as SafeET
from defusedxml.common import DefusedXmlException
from fastapi import UploadFile

from app.core.config import settings

FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.xml$", re.IGNORECASE)
ALLOWED_CT = {"text/xml", "application/xml", "application/octet-stream", ""}
CHUNK = 64 * 1024


class UploadRejected(Exception):
    pass


@dataclass
class StoredXml:
    original_filename: str
    stored_path: str
    size_bytes: int
    sha256: str
    is_valid: bool
    root_element: str | None
    validation_error: str | None
    hostname_hint: str | None  # hostname found inside the XML content


def batch_dir(batch_id: uuid.UUID) -> Path:
    base = settings.upload_dir.resolve()
    d = (base / str(batch_id)).resolve()
    if base not in d.parents:
        raise UploadRejected("invalid storage path")
    d.mkdir(parents=True, exist_ok=True, mode=0o750)
    return d


def sanitize_filename(name: str | None) -> str:
    name = os.path.basename((name or "").replace("\\", "/")).strip()
    if not FILENAME_RE.fullmatch(name):
        raise UploadRejected(f"'{name[:80]}' rejected: only .xml files with letters, digits, '.', '_' or '-' are allowed")
    return name


async def store_and_validate(upload: UploadFile, batch_id: uuid.UUID) -> StoredXml:
    filename = sanitize_filename(upload.filename)
    if (upload.content_type or "").split(";")[0].strip().lower() not in ALLOWED_CT:
        raise UploadRejected(f"{filename}: unsupported content type {upload.content_type}")

    dest_dir = batch_dir(batch_id)
    dest = (dest_dir / filename).resolve()
    if dest.parent != dest_dir:
        raise UploadRejected("path traversal attempt blocked")
    if dest.exists():
        raise UploadRejected(f"{filename}: duplicate filename in this upload")

    max_bytes = settings.max_xml_size_mb * 1024 * 1024
    digest, size = hashlib.sha256(), 0
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    try:
        with os.fdopen(fd, "wb") as fh:
            while chunk := await upload.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise UploadRejected(f"{filename}: exceeds {settings.max_xml_size_mb} MB limit")
                digest.update(chunk)
                fh.write(chunk)
    except UploadRejected:
        dest.unlink(missing_ok=True)
        raise

    if size == 0:
        dest.unlink(missing_ok=True)
        raise UploadRejected(f"{filename}: file is empty")

    is_valid, root, err, hint = True, None, None, None
    try:
        tree = SafeET.parse(str(dest), forbid_dtd=False, forbid_entities=True, forbid_external=True)
        root_el = tree.getroot()
        root = _local(root_el.tag)[:128]
        hint = _find_hostname(root_el)
    except DefusedXmlException:
        is_valid, err = False, "Rejected: entity declarations are not allowed"
    except SafeET.ParseError as e:
        is_valid, err = False, f"Malformed XML: {e}"[:1000]

    return StoredXml(filename, str(dest), size, digest.hexdigest(), is_valid, root, err, hint)


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1]


def _find_hostname(root) -> str | None:
    wanted = {t.lower() for t in settings.xml_hostname_tags}
    for el in root.iter():
        if _local(el.tag).lower() in wanted and el.text and el.text.strip():
            return el.text.strip()[:63]
        for attr, val in el.attrib.items():
            if _local(attr).lower() in wanted and val.strip():
                return val.strip()[:63]
    return None


def hostname_from_filename(filename: str) -> str:
    """POS001.xml -> POS001"""
    return filename.rsplit(".", 1)[0]


MAC_IN_NAME_RE = re.compile(r"(?<![0-9A-Fa-f])((?:[0-9A-Fa-f]{2}[:-]?){5}[0-9A-Fa-f]{2})(?![0-9A-Fa-f])")


def mac_from_filename(filename: str) -> str | None:
    """MarshalPOS-000C29D98489.XML -> 00:0c:29:d9:84:89"""
    m = MAC_IN_NAME_RE.search(filename.rsplit(".", 1)[0])
    if not m:
        return None
    h = re.sub(r"[^0-9A-Fa-f]", "", m.group(1)).lower()
    return ":".join(h[i:i + 2] for i in range(0, 12, 2))
