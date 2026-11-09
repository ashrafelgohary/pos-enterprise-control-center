"""Role-based access control. Roles are fixed in code (auditable, version-controlled)."""
from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


class Permission(str, Enum):
    USERS_MANAGE = "users:manage"
    POS_READ = "pos:read"
    POS_WRITE = "pos:write"
    POS_DELETE = "pos:delete"
    POS_IMPORT = "pos:import"
    XML_UPLOAD = "xml:upload"
    JOBS_RUN = "jobs:run"
    JOBS_READ = "jobs:read"
    AUDIT_READ = "audit:read"
    SYSTEM_READ = "system:read"


ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.ADMIN: frozenset(Permission),
    Role.OPERATOR: frozenset({
        Permission.POS_READ, Permission.POS_WRITE, Permission.POS_IMPORT,
        Permission.XML_UPLOAD, Permission.JOBS_RUN, Permission.JOBS_READ,
    }),
    Role.VIEWER: frozenset({Permission.POS_READ, Permission.JOBS_READ}),
}

PERMISSION_LABELS: dict[Permission, str] = {
    Permission.USERS_MANAGE: "Manage users",
    Permission.POS_READ: "View POS devices",
    Permission.POS_WRITE: "Add / edit POS devices",
    Permission.POS_DELETE: "Delete POS devices",
    Permission.POS_IMPORT: "Import / export POS devices",
    Permission.XML_UPLOAD: "Upload XML files",
    Permission.JOBS_RUN: "Run / retry / cancel Ansible jobs",
    Permission.JOBS_READ: "View job history",
    Permission.AUDIT_READ: "View audit logs",
    Permission.SYSTEM_READ: "View system settings",
}


def has_permission(role: str, perm: Permission) -> bool:
    try:
        return perm in ROLE_PERMISSIONS[Role(role)]
    except ValueError:
        return False


def permissions_for(role: str) -> list[str]:
    try:
        return sorted(p.value for p in ROLE_PERMISSIONS[Role(role)])
    except ValueError:
        return []
