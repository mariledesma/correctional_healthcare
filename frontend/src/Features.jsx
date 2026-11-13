import { useEffect, useState } from "react";
import { request, setToken } from "./api";
import { useAuth } from "./auth-context";
import "./Features.css";
const pct = value => value == null ? "Not measured" : `${Number(value).toFixed(1)}%`;
export default function Features({ page, facilities }) {
  const { user } = useAuth();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [analysis, setAnalysis] = useState(null);
  const [nearby, setNearby] = useState(null);
  useEffect(() => {
    let active = true;
    if (page === "accounts") request("/auth/users").then(rows => { if (active) setUsers(rows); }).catch(e => { if (active) setError(e.message); });
    if (page === "audit") request("/audit-logs").then(rows => { if (active) { setAudit(rows); setHasMore(rows.length === 50); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [page]);
  async function run(action) { setError(""); setMessage(""); setBusy(true); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  const heading = { accounts: "User accounts", audit: "Database audit trail", analysis: "Risk explanations & trends", spatial: "Nearby facilities", password: "Change password" }[page];
  return <section className="feature-card"><h1>{heading}</h1>
    {error && <p role="alert" className="feature-error">{error}</p>}{message && <p role="status">{message}</p>}
    {page === "accounts" && <>
      <p>Viewers read records. Editors add and update. Administrators also delete records, manage users, and inspect audit history.</p>
      <form className="feature-form" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const data = Object.fromEntries(new FormData(form)); run(async () => { await request("/auth/users", { method: "POST", body: data }); setUsers(await request("/auth/users")); form.reset(); setMessage("Account created."); }); }}>
        <label>Username<input name="username" required minLength={3} maxLength={100} /></label>
        <label>Initial password<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
        <label>Role<select name="role"><option>viewer</option><option>editor</option><option>admin</option></select></label>
        <button disabled={busy}>Create account</button>
      </form>
      <div className="feature-table"><table><thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Access</th></tr></thead><tbody>{users.map(u => <tr key={u.id}>
        <td>{u.username}{u.id === user.id ? " (you)" : ""}</td><td><select aria-label={`Role for ${u.username}`} value={u.role} disabled={busy || u.id === user.id} onChange={e => run(async () => { await request(`/auth/users/${u.id}`, { method: "PATCH", body: { role: e.target.value, active: u.active } }); setUsers(await request("/auth/users")); })}>{["viewer", "editor", "admin"].map(r => <option key={r}>{r}</option>)}</select></td>
        <td>{u.active ? "Active" : "Disabled"}</td><td><button disabled={busy || u.id === user.id} onClick={() => run(async () => { await request(`/auth/users/${u.id}`, { method: "PATCH", body: { role: u.role, active: !u.active } }); setUsers(await request("/auth/users")); })}>{u.active ? "Disable" : "Enable"}</button></td>
      </tr>)}</tbody></table></div>
    </>}
    {page === "audit" && <><p>Committed database changes, newest first. Blank actor means a direct database operation without an application user.</p>
      <div className="feature-table"><table><thead><tr><th>Time</th><th>Actor / DB user</th><th>Table</th><th>Action</th><th>Record</th><th>Changes</th></tr></thead><tbody>{audit.map(a => <tr key={a.id}><td>{new Date(a.occurred_at).toLocaleString()}</td><td>{a.actor_id || "Direct SQL"}<br /><small>{a.database_user}</small></td><td>{a.table_name}</td><td>{a.operation}</td><td>{a.record_id}</td><td><details><summary>Before / after</summary><pre>{JSON.stringify({ before: a.old_data, after: a.new_data }, null, 2)}</pre></details></td></tr>)}</tbody></table></div>
      {!audit.length && <p>No audit records yet.</p>}
      <button disabled={busy || !hasMore || !audit.length} onClick={() => run(async () => { const rows = await request(`/audit-logs?before=${audit.at(-1).id}`); setAudit([...audit, ...rows]); setHasMore(rows.length === 50); })}>Load older records</button>
    </>}
    {page === "analysis" && <>
      <form className="feature-form" onSubmit={e => { e.preventDefault(); const id = new FormData(e.currentTarget).get("facility"); run(async () => setAnalysis(await request(`/risk-analysis/${encodeURIComponent(id)}`))); }}>
        <label>Facility<select name="facility" required><option value="">Choose a facility</option>{facilities.map(f => <option key={f.facility_id} value={f.facility_id}>{f.facility_name || f.facility_id}</option>)}</select></label><button disabled={busy}>Explain risk</button>
      </form>
      {analysis && <><h2>{analysis.risk.facility_name}: {pct(analysis.risk.risk_pct)}</h2><p>{analysis.risk.risk_coverage} of 3 components measured. Missing data is not scored as zero.</p>
        <table><thead><tr><th>Component</th><th>Score</th><th>Effective weight</th><th>Contribution</th></tr></thead><tbody>{analysis.risk.explanation.components.map(c => <tr key={c.name}><td>{c.name}</td><td>{pct(c.score)}</td><td>{pct(c.effective_weight * 100)}</td><td>{c.contribution == null ? "—" : `${c.contribution.toFixed(1)} points`}</td></tr>)}</tbody></table>
        <p>Flagged checks: {analysis.risk.explanation.flagged_checks} / {analysis.risk.compliance_checks}. Long stays: {analysis.risk.explanation.long_stays} / {analysis.risk.explanation.measured_stays}. Staffing vacancies: {analysis.risk.staffing_vacancies} / {analysis.risk.explanation.staffing_target} target positions.</p>
        <h3>Hospital trend (latest 12 recorded months)</h3><table><thead><tr><th>Month</th><th>Visits</th><th>Long / measured stays</th><th>Known costs</th></tr></thead><tbody>{analysis.hospital_monthly.map(m => <tr key={m.month}><td>{m.month}</td><td>{m.visits}</td><td>{m.long_stays} / {m.measured_stays}</td><td>${Number(m.known_cost_usd).toLocaleString()} ({m.cost_records} records)</td></tr>)}</tbody></table>
        {analysis.hospital_monthly.length === 0 && <p>No dated visits are available for a trend.</p>}
        <h3>Interpretation limits</h3><ul>{analysis.limitations.map(l => <li key={l}>{l}</li>)}</ul>
      </>}
    </>}
    {page === "spatial" && <><p>Find facilities within a radius using PostGIS geography distances.</p>
      <form className="feature-form" onSubmit={e => { e.preventDefault(); const params = new URLSearchParams(new FormData(e.currentTarget)); run(async () => setNearby(await request(`/facilities-nearby?${params}`))); }}>
        <label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" required /></label>
        <label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" required /></label>
        <label>Radius (km)<input name="radius_km" type="number" step="any" min="0.1" max="500" defaultValue="25" required /></label><button disabled={busy}>Search nearby</button>
      </form>
      {nearby && <><p>{nearby.length} facilities returned (up to 100 closest results).</p><table><thead><tr><th>Facility</th><th>Distance</th></tr></thead><tbody>{nearby.map(f => <tr key={f.facility_id}><td>{f.facility_name || f.facility_id}</td><td>{Number(f.distance_km).toFixed(2)} km</td></tr>)}</tbody></table></>}
    </>}
    {page === "password" && <form className="feature-form" onSubmit={e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); run(async () => { await request("/auth/password", { method: "POST", body: data }); setToken(null); window.dispatchEvent(new Event("session-expired")); }); }}>
      <label>Current password<input name="current_password" type="password" required maxLength={128} autoComplete="current-password" /></label>
      <label>New password<input name="new_password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label><button disabled={busy}>Change password and sign out</button>
    </form>}
  </section>;
}
