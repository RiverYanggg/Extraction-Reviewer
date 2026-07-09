// ---------------------------------------------------------------------------
// Orchestrator: boot, render loop, global controls, keyboard, dividers.
// Panel rendering lives in source.js / tree.js / inspector.js;
// floating window in floating.js; metrics in metrics.js.
// ---------------------------------------------------------------------------
import { api } from "./api.js";
import { store } from "./store.js";
import { el, ui } from "./dom.js";
import { bus } from "./bus.js";
import { STATUS_COLORS, esc, toast } from "./util.js";
import { renderSourceBlocks, preparePdf, switchTab, highlightEvidence, cycleEvidence } from "./source.js";
import { renderFields, renderBucketRail, openBucketPreview } from "./tree.js";
import { renderInspector } from "./inspector.js";
import { openMetrics } from "./metrics.js";
import { initFloating } from "./floating.js";

// ---- render loop ----------------------------------------------------------
function render() {
  if (!store.data) return;
  renderProgress();
  renderSaveState();
  renderBucketRail();
  renderFields();
  renderInspector();
  el.taskStatus.value = store.doc.task_status;
  el.undo.disabled = !store.canUndo();
  el.redo.disabled = !store.canRedo();
}

function renderProgress() {
  const p = store.progress();
  el.progFill.style.width = p.pct + "%";
  const c = p.counts;
  el.progLabel.textContent =
    `${p.done}/${p.total} 已审 (${p.pct}%) · 确认${c.confirmed} 改${c.modified} 冲突${c.conflict} 待复核${c.needs_review} 补充${p.added}`;
}

function renderSaveState() {
  const s = store.saveState;
  el.saveState.className = "save-state" + (s === "dirty" ? " dirty" : s === "saving" ? " saving" : "");
  el.saveState.textContent = { saved: "已保存", dirty: "未保存…", saving: "保存中…", error: "保存失败" }[s];
}

function selectField(fid) {
  ui.selectedFieldId = fid;
  ui.evIndex = 0;
  const f = store.fieldIndex[fid];
  highlightEvidence(store.effectiveRefs(f), { scroll: true });
  render();
}

// ---- boot -----------------------------------------------------------------
async function boot() {
  bus.render = render;
  bus.selectField = selectField;
  bus.highlightEvidence = highlightEvidence;
  bus.switchTab = switchTab;

  buildLegend();
  buildHelp();
  wireGlobalControls();
  wireKeyboard();
  wireDividers();
  initFloating();

  let papers;
  try { ({ papers } = await api.listPapers()); }
  catch (e) {
    el.fieldsList.innerHTML = `<div class="inspector-empty">无法连接后端：${esc(e.message)}</div>`;
    return;
  }
  if (!papers.length) {
    el.fieldsList.innerHTML = `<div class="inspector-empty">未发现任何论文（检查 extracted/ 目录）。</div>`;
    return;
  }
  el.paperSelect.innerHTML = papers
    .map((p) => `<option value="${esc(p.paper_id)}">${esc(p.title)} — ${p.progress.pct}%</option>`)
    .join("");

  store.subscribe(render);
  await loadPaper(papers[0].paper_id);
}

async function loadPaper(pid) {
  el.fieldsList.innerHTML = `<div class="inspector-empty">加载中…</div>`;
  const payload = await api.getPaper(pid);
  store.load(payload);
  ui.selectedFieldId = null;
  ui.activeBucketId = payload.buckets[0]?.bucket_id || null;
  ui.evIndex = 0;
  ui.collapsed = new Set();
  el.paperSelect.value = pid;
  if (ui.tab === "pdf") switchTab("source");
  renderSourceBlocks();
  preparePdf();
  render();
}

// ---- global controls ------------------------------------------------------
function wireGlobalControls() {
  el.paperSelect.addEventListener("change", async (e) => { await store.flush(); await loadPaper(e.target.value); });
  el.undo.addEventListener("click", () => store.undo());
  el.redo.addEventListener("click", () => store.redo());
  el.save.addEventListener("click", async () => { await store.flush(); toast("已暂存草稿"); });
  el.metricsBtn.addEventListener("click", openMetrics);
  el.preview.addEventListener("click", openBucketPreview);
  el.taskStatus.addEventListener("change", (e) => store.setTaskStatus(e.target.value));
  el.export.addEventListener("click", onExport);
  el.help.addEventListener("click", () => el.helpModal.classList.remove("hidden"));
  el.helpClose.addEventListener("click", () => el.helpModal.classList.add("hidden"));
  el.helpModal.addEventListener("click", (e) => { if (e.target === el.helpModal) el.helpModal.classList.add("hidden"); });
  el.metricsClose.addEventListener("click", () => el.metricsModal.classList.add("hidden"));
  el.metricsModal.addEventListener("click", (e) => { if (e.target === el.metricsModal) el.metricsModal.classList.add("hidden"); });
  el.previewClose.addEventListener("click", () => el.previewModal.classList.add("hidden"));
  el.previewModal.addEventListener("click", (e) => { if (e.target === el.previewModal) el.previewModal.classList.add("hidden"); });

  el.fieldSearch.addEventListener("input", (e) => { ui.search = e.target.value; renderFields(); });
  el.filterStatus.addEventListener("change", (e) => { ui.filterStatus = e.target.value; renderFields(); });

  document.querySelectorAll("#source-tabs .tab").forEach((t) =>
    t.addEventListener("click", () => switchTab(t.dataset.tab)));

  window.addEventListener("beforeunload", (e) => {
    if (store.saveState === "dirty" || store.saveState === "saving") { store.flush(); e.preventDefault(); e.returnValue = ""; }
  });
}

async function onExport() {
  await store.flush();
  const p = store.progress();
  const unreviewed = p.total - p.done;
  if (unreviewed > 0 && !confirm(`还有 ${unreviewed} 个字段未审核（未确认/未修改）。仍要导出吗？`)) return;
  window.location.href = api.exportUrl(store.paperId);
  toast("正在生成导出包…");
}

// ---- keyboard -------------------------------------------------------------
function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !(e.metaKey || e.ctrlKey);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); store.undo(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); store.redo(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); store.flush(); toast("已暂存"); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") { e.preventDefault(); el.paperSelect.focus(); return; }
    if (typing) return;

    switch (e.key) {
      case "/": e.preventDefault(); el.fieldSearch.focus(); break;
      case "?": el.helpModal.classList.toggle("hidden"); break;
      case "j": moveSelection(1); break;
      case "k": moveSelection(-1); break;
      case "c": if (ui.selectedFieldId) store.setStatus(ui.selectedFieldId, "confirmed"); break;
      case "x": if (ui.selectedFieldId) store.setStatus(ui.selectedFieldId, "conflict"); break;
      case "r": if (ui.selectedFieldId) store.setStatus(ui.selectedFieldId, "needs_review"); break;
      case "e": if (ui.selectedFieldId) { const t = el.inspector.querySelector("#insp-val"); if (t) { t.focus(); e.preventDefault(); } } break;
      case "n": cycleEvidence(1); break;
      case "N": cycleEvidence(-1); break;
      case "Escape":
        el.helpModal.classList.add("hidden");
        el.metricsModal.classList.add("hidden");
        el.previewModal.classList.add("hidden");
        break;
    }
  });
}

function moveSelection(dir) {
  const rows = [...el.fieldsList.querySelectorAll(".field-row[data-field-id]")];
  if (!rows.length) return;
  let idx = rows.findIndex((r) => r.dataset.fieldId === ui.selectedFieldId);
  idx = Math.max(0, Math.min(rows.length - 1, idx + dir));
  selectField(rows[idx].dataset.fieldId);
  rows[idx].scrollIntoView({ block: "nearest" });
}

// ---- dividers -------------------------------------------------------------
function wireDividers() {
  const drag = (divider, pane, side) => {
    divider.addEventListener("mousedown", (e) => {
      const startX = e.clientX, startW = pane.getBoundingClientRect().width;
      const move = (ev) => {
        const dx = ev.clientX - startX;
        const w = side === "left" ? startW + dx : startW - dx;
        pane.style.flex = `0 0 ${Math.max(220, w)}px`;
      };
      const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
    });
  };
  drag(document.getElementById("divider-1"), document.getElementById("pane-source"), "left");
  drag(document.getElementById("divider-2"), document.getElementById("pane-inspector"), "right");
}

// ---- legend + help --------------------------------------------------------
function buildLegend() {
  const items = [
    ["unprocessed", "未处理"], ["confirmed", "已确认"], ["modified", "已修改"],
    ["needs_review", "待复核"], ["conflict", "冲突"], ["added", "已补充"],
  ];
  el.legend.innerHTML =
    `<span style="font-weight:600;color:var(--ink)">状态图例：</span>` +
    items.map(([k, label]) => `<span class="legend-item"><span class="legend-dot" style="background:${STATUS_COLORS[k]}"></span>${label}</span>`).join("") +
    `<span class="legend-item" style="margin-left:auto"><span class="badge ev-none">缺证据</span></span>
     <span class="legend-item"><span class="badge ev-weak">弱证据</span></span>
     <span class="legend-item"><span class="badge ev-strong">证据充分</span></span>
     <span class="legend-item">颜色=审核状态，徽章=证据质量</span>`;
}

function buildHelp() {
  el.helpBody.innerHTML = `
    <p>本工具用于人工审核结构化抽取结果。<b>颜色</b>=审核状态（一个维度），<b>徽章</b>=证据质量/置信度，避免颜色过载。中间是按 schema 还原的 <b>JSON 树</b>（含预定义 null 字段，均参与指标）。</p>
    <h3>快捷键（Windows / Mac 均支持）</h3>
    <table>
      <tr><th>Windows</th><th>Mac</th><th>作用</th></tr>
      <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td><kbd>j</kbd> / <kbd>k</kbd></td><td>下一个 / 上一个字段</td></tr>
      <tr><td><kbd>c</kbd></td><td><kbd>c</kbd></td><td>确认</td></tr>
      <tr><td><kbd>x</kbd></td><td><kbd>x</kbd></td><td>冲突</td></tr>
      <tr><td><kbd>r</kbd></td><td><kbd>r</kbd></td><td>待复核</td></tr>
      <tr><td><kbd>e</kbd></td><td><kbd>e</kbd></td><td>编辑当前值</td></tr>
      <tr><td><kbd>n</kbd> / <kbd>Shift</kbd>+<kbd>n</kbd></td><td><kbd>n</kbd> / <kbd>Shift</kbd>+<kbd>n</kbd></td><td>切换多证据</td></tr>
      <tr><td><kbd>/</kbd></td><td><kbd>/</kbd></td><td>聚焦搜索框</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 或 <kbd>Ctrl</kbd>+<kbd>Y</kbd></td><td><kbd>⌘</kbd>+<kbd>Z</kbd> / <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>撤销 / 重做</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td><kbd>⌘</kbd>+<kbd>S</kbd></td><td>暂存草稿</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>P</kbd></td><td><kbd>⌘</kbd>+<kbd>P</kbd></td><td>切换论文</td></tr>
      <tr><td><kbd>?</kbd></td><td><kbd>?</kbd></td><td>打开/关闭本帮助</td></tr>
    </table>
    <h3>纠错 + 补齐</h3>
    <p><b>错误字段</b>：右侧详情框改值并回车。<b>遗漏字段</b>：在 JSON 树目标节点点 <b>＋</b> 就地补充。右下悬浮窗可拖动，内含 <b>AI 助手</b> 和 <b>用户手册</b>。</p>`;
}

boot();
