export function derivePaperState(progress = {}) {
  const pct = Number(progress.pct) || 0;

  if (progress.task_status === "submitted" && pct < 100) {
    return { key: "inconsistent", label: "提交异常" };
  }
  if (pct >= 100) {
    return { key: "complete", label: "已完成" };
  }
  if (pct > 0) {
    return { key: "in-progress", label: "进行中" };
  }
  return { key: "not-started", label: "未开始" };
}

export function formatPaperSequence(index) {
  return String(index + 1).padStart(2, "0");
}

export function filterPapers(papers, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return papers;

  return papers.filter((paper) => {
    const searchable = `${paper.title || ""} ${paper.paper_id || ""}`.toLowerCase();
    return searchable.includes(needle);
  });
}
