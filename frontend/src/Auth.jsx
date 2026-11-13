import { useEffect, useState } from "react";
import { getToken, setToken, request } from "./api";
import "./Features.css";
import { AuthContext } from "./auth-context";
export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const expired = () => { setUser(null); setError("Your session ended. Please sign in."); };
    window.addEventListener("session-expired", expired);
    if (getToken()) request("/auth/me").then(u => { if (active) setUser(u); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener("session-expired", expired); };
  }, []);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await request("/auth/login", { method: "POST", body: data }); setToken(result.access_token); setUser(result.user); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function logout() {
    try { await request("/auth/logout", { method: "POST" }); }
    finally { setToken(null); setUser(null); }
  }
  if (loading) return <main className="auth-shell">Checking your session…</main>;
  if (!user) return <main className="auth-shell"><form className="feature-card login-card" onSubmit={login}>
    <h1>Sunrise Care</h1><p>Sign in to the correctional healthcare dashboard.</p>
    <label>Username<input name="username" autoComplete="username" required minLength={3} maxLength={100} /></label>
    <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
    {error && <p role="alert" className="feature-error">{error}</p>}
    <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    <small>Ask an administrator for an account. For first-time setup, run <code>cargo run --release -- --create-admin</code> in the backend folder.</small>
  </form></main>;
  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>;
}
