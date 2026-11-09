import re

from fastapi import HTTPException

from app.core.config import settings


def validate_password(pw: str, username: str = "") -> None:
    problems = []
    if len(pw) < settings.password_min_length:
        problems.append(f"at least {settings.password_min_length} characters")
    if not re.search(r"[A-Z]", pw) or not re.search(r"[a-z]", pw):
        problems.append("upper and lower case letters")
    if not re.search(r"\d", pw):
        problems.append("a digit")
    if not re.search(r"[^A-Za-z0-9]", pw):
        problems.append("a symbol")
    if username and username.lower() in pw.lower():
        problems.append("must not contain the username")
    if problems:
        raise HTTPException(422, "Password requires: " + ", ".join(problems))
