"""Passwords, JWTs and workspace authorization (role + group checks)."""
from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

import bcrypt
import jwt
import psycopg
from fastapi import Depends, Header, HTTPException

from .config import get_settings
from .db import get_db

ROLE_RANK = {"viewer": 1, "member": 2, "admin": 3, "owner": 4}


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt(rounds=11)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


def make_token(user_id: str) -> str:
    s = get_settings()
    import os
    if os.environ.get("VERCEL") and (s.jwt_secret == "dev-only-change-me" or len(s.jwt_secret) < 32):
        raise RuntimeError("Set a JWT_SECRET of at least 32 characters in production")
    now = dt.datetime.now(dt.timezone.utc)
    return jwt.encode({"sub": str(user_id), "iat": now, "exp": now + dt.timedelta(hours=s.jwt_ttl_hours)}, s.jwt_secret, algorithm="HS256")


@dataclass
class CurrentUser:
    id: str
    email: str
    name: str


def current_user(authorization: str = Header(default=""), db: psycopg.Connection = Depends(get_db)) -> CurrentUser:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in required")
    try:
        payload = jwt.decode(authorization[7:], get_settings().jwt_secret, algorithms=["HS256"])
        uid = str(uuid.UUID(payload["sub"]))
    except Exception:
        raise HTTPException(401, "Session expired, please sign in again")
    row = db.execute("SELECT id, email, name FROM users WHERE id = %s", (uid,)).fetchone()
    if not row:
        raise HTTPException(401, "Account not found")
    return CurrentUser(id=str(row["id"]), email=row["email"], name=row["name"])


@dataclass
class Access:
    """What a user may do and see inside one workspace."""
    user: CurrentUser
    workspace_id: str
    role: str
    group_ids: list[str]

    @property
    def sees_everything(self) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK["admin"]

    def require(self, min_role: str) -> None:
        if ROLE_RANK[self.role] < ROLE_RANK[min_role]:
            raise HTTPException(403, f"This needs the {min_role} role or higher")


def workspace_access(db: psycopg.Connection, user: CurrentUser, workspace_id: str) -> Access:
    try:
        workspace_id = str(uuid.UUID(workspace_id))
    except ValueError:
        raise HTTPException(404, "Workspace not found")
    row = db.execute("SELECT role FROM memberships WHERE workspace_id = %s AND user_id = %s", (workspace_id, user.id)).fetchone()
    if not row:
        raise HTTPException(404, "Workspace not found")
    groups = db.execute(
        "SELECT g.id FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE g.workspace_id = %s AND gm.user_id = %s",
        (workspace_id, user.id),
    ).fetchall()
    return Access(user=user, workspace_id=workspace_id, role=row["role"], group_ids=[str(g["id"]) for g in groups])


def access_dep(workspace_id: str, user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)) -> Access:
    return workspace_access(db, user, workspace_id)


# SQL fragment: a document row `d` is visible to the access holder. Used by every retrieval query.
def visible_sql(ready_only: bool = True) -> str:
    return f"""(d.workspace_id = %(ws)s {"AND d.status = 'ready'" if ready_only else ""} AND (
    %(all)s OR d.access = 'workspace' OR EXISTS (
        SELECT 1 FROM document_groups dg WHERE dg.document_id = d.id AND dg.group_id = ANY(%(groups)s::uuid[])
    )))"""


VISIBLE_SQL = visible_sql()


def visible_params(a: Access) -> dict:
    return {"ws": a.workspace_id, "all": a.sees_everything, "groups": a.group_ids}
