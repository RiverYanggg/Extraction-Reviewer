// Thin fetch wrapper around the backend API.
async function j(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json();
}

export const api = {
  listPapers: () => j("/api/papers"),
  getPaper: (pid) => j(`/api/papers/${encodeURIComponent(pid)}`),
  saveAnnotation: (pid, annotation) =>
    j(`/api/papers/${encodeURIComponent(pid)}/annotation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotation }),
    }),
  exportUrl: (pid) => `/api/papers/${encodeURIComponent(pid)}/export`,
};
