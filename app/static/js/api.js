// Thin fetch wrapper around the backend API.
async function j(url, opts) {
  const res = await fetch(url, { credentials: "same-origin", ...(opts || {}) });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json();
}

export const api = {
  me: () => j("/api/auth/me"),
  login: (username, password) =>
    j("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => j("/api/auth/logout", { method: "POST" }),
  listPapers: () => j("/api/papers"),
  getPaper: (pid) => j(`/api/papers/${encodeURIComponent(pid)}`),
  saveAnnotation: (pid, annotation) =>
    j(`/api/papers/${encodeURIComponent(pid)}/annotation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotation }),
    }),
  metrics: (pid) => j(`/api/papers/${encodeURIComponent(pid)}/metrics`),
  exportUrl: (pid) => `/api/papers/${encodeURIComponent(pid)}/export`,
  exportAllUrl: () => "/api/export/all",
  manual: () => j("/api/manual"),
  assistant: (messages, paper_id, context) =>
    j("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, paper_id, context }),
    }),
};
