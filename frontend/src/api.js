export const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const key = "healthcare-session";
export const getToken = () => sessionStorage.getItem(key);
export function setToken(token) {
  if (token) sessionStorage.setItem(key, token);
  else sessionStorage.removeItem(key);
}
export async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  if (getToken()) headers.set("Authorization", `Bearer ${getToken()}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && !url.endsWith("/auth/login")) {
    setToken(null);
    window.dispatchEvent(new Event("session-expired"));
  }
  return response;
}
export async function request(path, options = {}) {
  const response = await apiFetch(`${API_URL}${path}`, {
    ...options, headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}
