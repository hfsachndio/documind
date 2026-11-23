from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import get_db
from ..security import ROLE_RANK, Access, CurrentUser, access_dep, current_user

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class InviteIn(BaseModel):
    email: str = Field(max_length=200)
    role: str = Field(pattern="^(admin|member|viewer)$")


class RoleIn(BaseModel):
    role: str = Field(pattern="^(admin|member|viewer)$")


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class GroupMembersIn(BaseModel):
    user_ids: list[str]


@router.post("", status_code=201)
def create(body: WorkspaceIn, user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    ws = db.execute("INSERT INTO workspaces (name, created_by) VALUES (%s, %s) RETURNING id, name", (body.name.strip(), user.id)).fetchone()
    db.execute("INSERT INTO memberships (workspace_id, user_id, role) VALUES (%s, %s, 'owner')", (ws["id"], user.id))
    return {"id": str(ws["id"]), "name": ws["name"], "role": "owner", "documents": 0, "members": 1}


@router.get("/{workspace_id}")
def detail(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    ws = db.execute("SELECT id, name, created_at FROM workspaces WHERE id = %s", (a.workspace_id,)).fetchone()
    return {"id": str(ws["id"]), "name": ws["name"], "role": a.role, "my_groups": a.group_ids}


@router.patch("/{workspace_id}")
def rename(body: WorkspaceIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("admin")
    db.execute("UPDATE workspaces SET name = %s WHERE id = %s", (body.name.strip(), a.workspace_id))
    return {"ok": True}


@router.delete("/{workspace_id}")
def delete(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("owner")
    db.execute("DELETE FROM workspaces WHERE id = %s", (a.workspace_id,))
    return {"ok": True}


@router.get("/{workspace_id}/members")
def members(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT u.id, u.name, u.email, m.role,
                  COALESCE(array_agg(g.id) FILTER (WHERE g.id IS NOT NULL), '{}') AS group_ids
           FROM memberships m JOIN users u ON u.id = m.user_id
           LEFT JOIN group_members gm ON gm.user_id = u.id
           LEFT JOIN groups g ON g.id = gm.group_id AND g.workspace_id = m.workspace_id
           WHERE m.workspace_id = %s GROUP BY u.id, u.name, u.email, m.role, m.created_at ORDER BY m.created_at""",
        (a.workspace_id,)).fetchall()
    invites = db.execute("SELECT email, role, created_at FROM invites WHERE workspace_id = %s ORDER BY created_at", (a.workspace_id,)).fetchall()
    return {"members": [{**r, "id": str(r["id"]), "group_ids": [str(g) for g in r["group_ids"]]} for r in rows],
            "invites": invites if ROLE_RANK[a.role] >= ROLE_RANK["admin"] else []}


@router.post("/{workspace_id}/members", status_code=201)
def invite(body: InviteIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    """Adds an existing user straight away; otherwise records an invite that applies when they sign up."""
    a.require("admin")
    email = body.email.strip().lower()
    user = db.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
    if user:
        db.execute("INSERT INTO memberships (workspace_id, user_id, role) VALUES (%s, %s, %s) ON CONFLICT (workspace_id, user_id) DO NOTHING",
                   (a.workspace_id, user["id"], body.role))
        return {"status": "added"}
    db.execute("INSERT INTO invites (workspace_id, email, role) VALUES (%s, %s, %s) ON CONFLICT (workspace_id, email) DO UPDATE SET role = EXCLUDED.role",
               (a.workspace_id, email, body.role))
    return {"status": "invited"}


@router.delete("/{workspace_id}/invites/{email}")
def cancel_invite(email: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("admin")
    db.execute("DELETE FROM invites WHERE workspace_id = %s AND email = %s", (a.workspace_id, email.lower()))
    return {"ok": True}


def _target_role(db, a: Access, user_id: str) -> str:
    row = db.execute("SELECT role FROM memberships WHERE workspace_id = %s AND user_id = %s", (a.workspace_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, "Member not found")
    if row["role"] == "owner":
        raise HTTPException(400, "The owner's role can't be changed")
    return row["role"]


@router.patch("/{workspace_id}/members/{user_id}")
def set_role(user_id: str, body: RoleIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("admin")
    _target_role(db, a, user_id)
    db.execute("UPDATE memberships SET role = %s WHERE workspace_id = %s AND user_id = %s", (body.role, a.workspace_id, user_id))
    return {"ok": True}


@router.delete("/{workspace_id}/members/{user_id}")
def remove(user_id: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    if user_id != a.user.id:
        a.require("admin")
    _target_role(db, a, user_id)
    db.execute("DELETE FROM group_members WHERE user_id = %s AND group_id IN (SELECT id FROM groups WHERE workspace_id = %s)", (user_id, a.workspace_id))
    db.execute("DELETE FROM memberships WHERE workspace_id = %s AND user_id = %s", (a.workspace_id, user_id))
    return {"ok": True}


@router.get("/{workspace_id}/groups")
def groups(a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT g.id, g.name, count(gm.user_id) AS members,
                  (SELECT count(*) FROM document_groups dg WHERE dg.group_id = g.id) AS documents
           FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id
           WHERE g.workspace_id = %s GROUP BY g.id ORDER BY g.name""", (a.workspace_id,)).fetchall()
    return [{**r, "id": str(r["id"])} for r in rows]


@router.post("/{workspace_id}/groups", status_code=201)
def create_group(body: GroupIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("admin")
    row = db.execute("INSERT INTO groups (workspace_id, name) VALUES (%s, %s) ON CONFLICT (workspace_id, name) DO NOTHING RETURNING id",
                     (a.workspace_id, body.name.strip())).fetchone()
    if not row:
        raise HTTPException(409, "A group with this name already exists")
    return {"id": str(row["id"]), "name": body.name.strip(), "members": 0, "documents": 0}


@router.put("/{workspace_id}/groups/{group_id}/members")
def set_group_members(group_id: str, body: GroupMembersIn, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("admin")
    if not db.execute("SELECT 1 FROM groups WHERE id = %s AND workspace_id = %s", (group_id, a.workspace_id)).fetchone():
        raise HTTPException(404, "Group not found")
    db.execute("DELETE FROM group_members WHERE group_id = %s", (group_id,))
    for uid in body.user_ids:
        db.execute("""INSERT INTO group_members (group_id, user_id)
                      SELECT %s, user_id FROM memberships WHERE workspace_id = %s AND user_id = %s ON CONFLICT DO NOTHING""",
                   (group_id, a.workspace_id, uid))
    return {"ok": True}


@router.delete("/{workspace_id}/groups/{group_id}")
def delete_group(group_id: str, a: Access = Depends(access_dep), db: psycopg.Connection = Depends(get_db)):
    a.require("admin")
    db.execute("DELETE FROM groups WHERE id = %s AND workspace_id = %s", (group_id, a.workspace_id))
    # documents left with no groups fall back to admins-only visibility (still 'groups' access): safe default
    return {"ok": True}
