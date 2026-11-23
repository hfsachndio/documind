from __future__ import annotations

import re

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..security import CurrentUser, current_user, hash_password, make_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=200)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: str
    password: str


def _workspaces(db: psycopg.Connection, user_id: str) -> list[dict]:
    rows = db.execute(
        """SELECT w.id, w.name, m.role,
                  (SELECT count(*) FROM documents d WHERE d.workspace_id = w.id) AS documents,
                  (SELECT count(*) FROM memberships m2 WHERE m2.workspace_id = w.id) AS members
           FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
           WHERE m.user_id = %s ORDER BY w.created_at""", (user_id,)).fetchall()
    return [{**r, "id": str(r["id"])} for r in rows]


def _session(db: psycopg.Connection, user: dict) -> dict:
    uid = str(user["id"])
    return {"token": make_token(uid), "user": {"id": uid, "name": user["name"], "email": user["email"]},
            "workspaces": _workspaces(db, uid)}


@router.post("/signup", status_code=201)
def signup(body: SignupIn, db: psycopg.Connection = Depends(get_db)):
    email = body.email.strip().lower()
    if not EMAIL.match(email):
        raise HTTPException(422, "Enter a valid email address")
    if db.execute("SELECT 1 FROM users WHERE email = %s", (email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    user = db.execute("INSERT INTO users (email, name, password_hash) VALUES (%s, %s, %s) RETURNING id, email, name",
                      (email, body.name.strip(), hash_password(body.password))).fetchone()
    # Accept pending invites; otherwise give the new user their own workspace.
    invites = db.execute("DELETE FROM invites WHERE email = %s RETURNING workspace_id, role", (email,)).fetchall()
    for inv in invites:
        db.execute("INSERT INTO memberships (workspace_id, user_id, role) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                   (inv["workspace_id"], user["id"], inv["role"]))
    if not invites:
        ws = db.execute("INSERT INTO workspaces (name, created_by) VALUES (%s, %s) RETURNING id",
                        (f"{body.name.strip().split()[0]}'s workspace", user["id"])).fetchone()
        db.execute("INSERT INTO memberships (workspace_id, user_id, role) VALUES (%s, %s, 'owner')", (ws["id"], user["id"]))
    return _session(db, user)


@router.post("/login")
def login(body: LoginIn, db: psycopg.Connection = Depends(get_db)):
    user = db.execute("SELECT id, email, name, password_hash FROM users WHERE email = %s", (body.email.strip().lower(),)).fetchone()
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Incorrect email or password")
    return _session(db, user)


@router.get("/me")
def me(user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    return {"user": {"id": user.id, "name": user.name, "email": user.email}, "workspaces": _workspaces(db, user.id)}
