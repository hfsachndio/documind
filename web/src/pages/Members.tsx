import { useCallback, useEffect, useState } from "react";
import { Lock, Plus, Trash2, UserPlus } from "lucide-react";
import { api, type Group, type Member, type Role } from "../lib/api";
import { isAdmin, useAuth } from "../lib/auth";
import { useWs } from "../components/AppShell";
import { ErrorNote, Modal, PageHeader, RoleBadge, Spinner, toast } from "../components/ui";

const ROLE_HELP: Record<string, string> = {
  admin: "Manage members, groups and access; sees every document",
  member: "Upload documents and ask questions",
  viewer: "Ask questions only",
};

function GroupDialog({ ws, group, members, onClose, onSaved }: { ws: string; group: Group; members: Member[]; onClose: () => void; onSaved: () => void }) {
  const [sel, setSel] = useState(members.filter((m) => m.group_ids.includes(group.id)).map((m) => m.id));
  return (
    <Modal title={`Members of ${group.name}`} onClose={onClose}>
      <p className="text-sm text-ink-3 mb-3">People in this group can retrieve documents restricted to “{group.name}”.</p>
      <div className="space-y-1 max-h-80 overflow-y-auto">
        {members.map((m) => (
          <label key={m.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-paper cursor-pointer">
            <input type="checkbox" checked={sel.includes(m.id)} onChange={(e) => setSel(e.target.checked ? [...sel, m.id] : sel.filter((x) => x !== m.id))} />
            <span className="text-sm flex-1">{m.name} <span className="text-ink-3">{m.email}</span></span><RoleBadge role={m.role} />
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={async () => { await api(`/workspaces/${ws}/groups/${group.id}/members`, { method: "PUT", body: { user_ids: sel } }); toast("Group updated"); onSaved(); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

export default function Members() {
  const { ws, role } = useWs();
  const { user } = useAuth();
  const [data, setData] = useState<{ members: Member[]; invites: { email: string; role: Role }[] } | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");
  const [groupName, setGroupName] = useState("");
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Group | null>(null);
  const admin = isAdmin(role);
  const load = useCallback(() => {
    api<typeof data>(`/workspaces/${ws}/members`).then(setData).catch(() => {});
    api<Group[]>(`/workspaces/${ws}/groups`).then(setGroups).catch(() => {});
  }, [ws]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="grid place-items-center py-20"><Spinner /></div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8">
      <PageHeader title="Members & groups" subtitle="Roles control what people can do. Groups control which restricted documents they can retrieve, enforced inside every search." />
      {admin && (
        <form className="card p-4 mb-6 flex flex-wrap gap-2 items-end" onSubmit={async (e) => {
          e.preventDefault(); setErr("");
          try {
            const r = await api<{ status: string }>(`/workspaces/${ws}/members`, { body: { email, role: newRole } });
            toast(r.status === "added" ? `${email} added` : `Invite saved: ${email} joins when they sign up with this email`);
            setEmail(""); load();
          } catch (x) { setErr((x as Error).message); }
        }}>
          <div className="flex-1 min-w-56"><label className="label" htmlFor="em">Invite by email</label>
            <input id="em" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" /></div>
          <div><label className="label" htmlFor="rl">Role</label>
            <select id="rl" className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              <option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
            </select></div>
          <button className="btn-primary"><UserPlus className="size-4" /> Invite</button>
          <div className="w-full"><ErrorNote>{err}</ErrorNote></div>
        </form>
      )}
      <section className="card divide-y divide-line mb-8">
        {data.members.map((m) => (
          <div key={m.id} className="p-4 flex flex-wrap items-center gap-3">
            <div className="size-9 rounded-full bg-brand-soft text-brand grid place-items-center font-semibold">{m.name[0]?.toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{m.name}{m.id === user?.id && <span className="text-ink-3 font-normal"> (you)</span>}</div>
              <div className="text-xs text-ink-3">{m.email}{m.group_ids.length > 0 && ` · ${groups.filter((g) => m.group_ids.includes(g.id)).map((g) => g.name).join(", ")}`}</div>
            </div>
            {admin && m.role !== "owner" ? (
              <select aria-label={`Role for ${m.name}`} className="input w-32 h-9" value={m.role} onChange={async (e) => {
                try { await api(`/workspaces/${ws}/members/${m.id}`, { method: "PATCH", body: { role: e.target.value } }); toast("Role updated"); load(); }
                catch (x) { toast((x as Error).message, "err"); }
              }}>
                <option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
              </select>
            ) : <RoleBadge role={m.role} />}
            {admin && m.role !== "owner" && m.id !== user?.id && (
              <button className="btn-ghost h-9 px-2 text-ink-3 hover:text-bad" aria-label={`Remove ${m.name}`} onClick={async () => {
                if (!confirm(`Remove ${m.name} from this workspace?`)) return;
                await api(`/workspaces/${ws}/members/${m.id}`, { method: "DELETE" }); load();
              }}><Trash2 className="size-4" /></button>
            )}
          </div>
        ))}
        {data.invites.map((i) => (
          <div key={i.email} className="p-4 flex items-center gap-3 bg-paper/50">
            <div className="size-9 rounded-full border border-dashed border-ink-3/40 grid place-items-center text-ink-3">?</div>
            <div className="flex-1 text-sm">{i.email} <span className="text-xs text-ink-3">· invited, joins on sign-up</span></div>
            <RoleBadge role={i.role} />
            <button className="btn-ghost h-9 px-2 text-ink-3 hover:text-bad" aria-label={`Cancel invite for ${i.email}`}
              onClick={async () => { await api(`/workspaces/${ws}/invites/${encodeURIComponent(i.email)}`, { method: "DELETE" }); load(); }}><Trash2 className="size-4" /></button>
          </div>
        ))}
      </section>
      <div className="text-xs text-ink-3 grid sm:grid-cols-3 gap-2 mb-8">
        {Object.entries(ROLE_HELP).map(([k, v]) => <div key={k}><RoleBadge role={k} /> <span className="ml-1">{v}</span></div>)}
      </div>

      <h2 className="font-display text-3xl mb-1">Groups</h2>
      <p className="text-sm text-ink-3 mb-4">Restrict sensitive documents (salaries, contracts, HR files) to a group. Everyone else's searches skip them entirely.</p>
      {admin && (
        <form className="flex gap-2 mb-4" onSubmit={async (e) => {
          e.preventDefault();
          try { await api(`/workspaces/${ws}/groups`, { body: { name: groupName } }); setGroupName(""); load(); }
          catch (x) { toast((x as Error).message, "err"); }
        }}>
          <input className="input max-w-xs" placeholder="New group, e.g. Finance" value={groupName} onChange={(e) => setGroupName(e.target.value)} required />
          <button className="btn-outline"><Plus className="size-4" /> Create group</button>
        </form>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {groups.length === 0 && <p className="text-sm text-ink-3">No groups yet.</p>}
        {groups.map((g) => (
          <div key={g.id} className="card p-4 flex items-center gap-3">
            <div className="size-9 rounded-xl bg-night text-white grid place-items-center"><Lock className="size-4" /></div>
            <div className="flex-1"><div className="font-semibold text-sm">{g.name}</div><div className="text-xs text-ink-3">{g.members} people · {g.documents} restricted documents</div></div>
            {admin && <>
              <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setEditing(g)}>People</button>
              <button className="btn-ghost h-8 px-2 text-ink-3 hover:text-bad" aria-label={`Delete group ${g.name}`} onClick={async () => {
                if (!confirm(`Delete the ${g.name} group? Documents restricted only to it become visible to admins only.`)) return;
                await api(`/workspaces/${ws}/groups/${g.id}`, { method: "DELETE" }); load();
              }}><Trash2 className="size-4" /></button>
            </>}
          </div>
        ))}
      </div>
      {editing && <GroupDialog ws={ws} group={editing} members={data.members} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
