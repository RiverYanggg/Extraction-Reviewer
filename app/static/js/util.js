// Shared helpers + constants (no DOM/store deps).
export const $ = (sel, root = document) => root.querySelector(sel);

export const STATUS_LABELS = {
  unprocessed: "未处理", confirmed: "已确认", modified: "已修改",
  added: "已补充", needs_review: "待复核", conflict: "冲突",
};
export const STATUS_COLORS = {
  unprocessed: "var(--st-unprocessed)", confirmed: "var(--st-confirmed)",
  modified: "var(--st-modified)", added: "var(--st-added)",
  needs_review: "var(--st-needs)", conflict: "var(--st-conflict)",
};
export const SECTION_LABELS = {
  paper: "论文元数据", papers: "论文元数据", alloy: "合金成分", alloys: "合金成分",
  process: "工艺", processes: "工艺", processing_steps: "工艺步骤",
  sample: "样品", samples: "样品", structures: "微观结构", interfaces: "界面",
  properties: "性能", performance: "服役性能", characterization_methods: "表征方法",
  computational_details: "计算细节", unmapped_findings: "未映射发现",
};

export function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function evClass(label) {
  return { explicit_supported: "ev-strong", numeric_supported: "ev-num",
           weak_supported: "ev-weak", unsupported: "ev-none",
           untracked: "ev-weak" }[label] || "ev-weak";
}
export function evLabelText(label) {
  return { explicit_supported: "证据充分", numeric_supported: "数值匹配",
           weak_supported: "弱证据", unsupported: "无证据",
           untracked: "未追踪" }[label] || label;
}

let toastTimer;
export function toast(msg, isErr = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

// Minimal, safe markdown -> HTML (for the trusted local user manual).
export function markdown(md) {
  const lines = String(md).split("\n");
  let html = "", inCode = false, inList = false, tbl = [];
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const flushTable = () => {
    if (!tbl.length) return;
    const rows = tbl.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
    html += "<table>" + rows.map((r, i) => {
      const cells = r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const tag = i === 0 ? "th" : "td";
      return "<tr>" + cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("") + "</tr>";
    }).join("") + "</table>";
    tbl = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushTable(); inCode = !inCode; html += inCode ? "<pre>" : "</pre>"; continue;
    }
    if (inCode) { html += esc(line) + "\n"; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { tbl.push(line.trim()); continue; }
    flushTable();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { if (inList) { html += "</ul>"; inList = false; } html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (line.trim() === "") continue;
    html += `<p>${inline(line)}</p>`;
  }
  flushTable();
  if (inList) html += "</ul>";
  if (inCode) html += "</pre>";
  return html;
}
