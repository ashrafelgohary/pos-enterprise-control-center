"""Bootstrap CLI: `python -m app.cli bootstrap` creates the initial admin if no users exist."""
import sys

from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import session_scope
from app.models import User
from app.services import audit_service as audit


def bootstrap() -> None:
    with session_scope() as db:
        if db.scalar(select(func.count()).select_from(User)):
            print("users exist - bootstrap skipped")
            return
        if not settings.initial_admin_password or len(settings.initial_admin_password) < 12:
            sys.exit("INITIAL_ADMIN_PASSWORD (>=12 chars) is required for first start")
        u = User(username=settings.initial_admin_username, email=settings.initial_admin_email.lower(),
                 full_name="Administrator", role="admin", password_hash=hash_password(settings.initial_admin_password))
        db.add(u)
        db.flush()
        audit.record(db, audit.AuditAction.USER_CREATED, username="system", target=f"user {u.username}",
                     details={"role": "admin", "bootstrap": True})
        print(f"created initial admin '{u.username}' - change the password after first login and remove INITIAL_ADMIN_PASSWORD")


def seed_demo() -> None:
    """Optional demo data for development: `python -m app.cli seed-demo`."""
    import random
    from app.models import PosDevice
    stores = ["H&M City Stars", "AE Mall of Egypt", "Bath & Body Works CFC", "Starbucks Almaza", "Victoria's Secret MOA"]
    with session_scope() as db:
        for i in range(1, 41):
            db.add(PosDevice(hostname=f"POS{i:03d}", ip_address=f"10.148.{100 + i // 10}.{10 + i}",
                             mac_address=f"00:1a:2b:{i:02x}:3c:4d", store_name=random.choice(stores),
                             brand=random.choice(["HP", "Toshiba", "NCR"]), status=random.choice(["online"] * 9 + ["offline"])))
    print("demo POS created")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "bootstrap"
    {"bootstrap": bootstrap, "seed-demo": seed_demo}[cmd]()
