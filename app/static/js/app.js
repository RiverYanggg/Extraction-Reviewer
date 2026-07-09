// ---------------------------------------------------------------------------
// Evidence Note Annotator — UI controller
// ---------------------------------------------------------------------------
import { api } from "./api.js";
import { store } from "./store.js";

// ---- constants ------------------------------------------------------------
const STATUS_LABELS = {
  unprocessed: "未处理",
  confirmed: "已确认",
  modified: "已修改",
  added: "已补充",
  needs_review: "待复核",
  conflict: "冲突",
};
const STATUS_COLORS = {
  unprocessed: "var(--st-unprocessed)",
  confirmed: "var(--st-confirmed)",
  modified: "var(--st-modified)",
  added: "var(--st-added)",
  needs_review: "var(--st-needs)",
  conflict: "var(--st-conflict)",
};
const SECTION_LABELS = {
  paper: "论文元数据", papers: "论文元数据",
  alloy: "合金成分", alloys: "合金成分",
  process: "工艺", processes: "工艺",
  processing_steps: "工艺步骤",
  sample: "样品", samples: "样品",
  structures: "微观结构",
  interfaces: "界面",
  properties: "性能",
  performance: "服役性能",
  characterization_methods: "表征方法",
  computational_details: "计算细节",
  unmapped_findings: "未映射发现",
};

// ---- UI-only state (not persisted) ---------------------------------------
const ui = {
  selectedFieldId: null,
  activeBucketId: null,
  search: "",
  filterStatus: "",
  evIndex: 0,          // active evidence index for multi-ref fields
  tab: "source",
};

// ---- DOM refs -------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const el = {
  paperSelect: $("#paper-select"),
  progFill: $("#progress-fill"),
  progLabel: $("#progress-label"),
  saveState: $("#save-state"),
  undo: $("#btn-undo"),
  redo: $("#btn-redo"),
  taskStatus: $("#task-status"),
  export: $("#btn-export"),
  help: $("#btn-help"),
  sourceBlocks: $("#source-blocks"),
  knowledgeView: $("#knowledge-view"),
  sourceScroll: $("#source-scroll"),
  evidenceStatus: $("#evidence-status"),
  bucketRail: $("#bucket-rail"),
  fieldsList: $("#fields-list"),
  fieldSearch: $("#field-search"),
  filterStatus: $("#filter-status"),
  inspector: $("#inspector-body"),
  legend: $("#legend"),
  helpModal: $("#help-modal"),
  helpBody: $("#help-body"),
  helpClose: $("#help-close"),
  toast: $("#toast"),
};

// ---- small utils ----------------------------------------------------------
function toast(msg, isErr = false) {
  el.toast.textContent = msg;
  el.toast.className = "toast" + (isErr ? " err" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.add("hidden"), 2600);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function evClass(label) {
  return {
    explicit_supported: "ev-strong",
    numeric_supported: "ev-num",
    weak_supported: "ev-weak",
    unsupported: "ev-none",
  }[label] || "ev-weak";
}
function evLabelText(label) {
  return {
    explicit_supported: "证据充分",
    numeric_supported: "数值匹配",
    weak_supported: "弱证据",
    unsupported: "无证据",
  }[label] || label;
}

// ===========================================================================
// Boot
// ===========================================================================
async function boot() {
  buildLegend();
  buildHelp();
  wireGlobalControls();
  wireKeyboard();
  wireDividers();

  let papers;
  try {
    ({ papers } = await api.listPapers());
  } catch (e) {
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
  el.paperSelect.value = pid;
  renderSourceBlocks();
  renderKnowledge();
  render();
}

// ===========================================================================
// Render (subscriber) — cheap parts every time, lists rebuilt too
// ===========================================================================
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
  el.saveState.textContent =
    { saved: "已保存", dirty: "未保存…", saving: "保存中…", error: "保存失败" }[s];
}

// ---- Left: source blocks (built once per paper) ---------------------------
function renderSourceBlocks() {
  const frag = document.createDocumentFragment();
  for (const b of store.data.blocks) {
    const div = document.createElement("div");
    div.className = "blk";
    div.dataset.blockId = b.block_id;
    div.dataset.kind = b.kind;
    if (b.level) div.dataset.level = b.level;

    const idTag = document.createElement("span");
    idTag.className = "blk-id";
    idTag.textContent = b.block_id;
    div.appendChild(idTag);

    if (b.kind === "image" && b.image_src) {
      const img = document.createElement("img");
      img.src = store.data.asset_base + b.image_src.replace(/^\.?\//, "");
      img.alt = b.block_id;
      img.loading = "lazy";
      img.onerror = () => { img.replaceWith(document.createTextNode(`🖼 ${b.image_src}`)); };
      div.appendChild(img);
    } else {
      const txt = document.createElement("span");
      txt.textContent = b.kind === "heading" ? b.heading_text : b.text;
      div.appendChild(txt);
    }
    // click a block -> reveal fields citing it
    div.addEventListener("click", () => selectFirstFieldCiting(b.block_id));
    frag.appendChild(div);
  }
  el.sourceBlocks.replaceChildren(frag);
}

function selectFirstFieldCiting(blockId) {
  const f = store.data.fields.find((f) => store.effectiveRefs(f).includes(blockId));
  if (f) { selectField(f.field_id); }
}

// ---- Left: knowledge tab (built once) -------------------------------------
function renderKnowledge() {
  el.knowledgeView.innerHTML = miniMarkdown(store.data.knowledge_md || "_无知识摘要_");
}

// ---- Center: bucket rail --------------------------------------------------
function renderBucketRail() {
  const frag = document.createDocumentFragment();
  for (const b of store.data.buckets) {
    const chip = document.createElement("div");
    chip.className = "bucket-chip" + (b.bucket_id === ui.activeBucketId ? " active" : "");
    // per-bucket status distribution mini-bar
    const dist = { confirmed: 0, modified: 0, conflict: 0, needs_review: 0, unprocessed: 0 };
    for (const fid of b.field_ids) dist[store.statusOf(fid)]++;
    const total = b.field_ids.length || 1;
    const segs = ["confirmed", "modified", "needs_review", "conflict", "unprocessed"]
      .filter((k) => dist[k])
      .map((k) => `<span class="bc-seg" style="flex:${dist[k]};background:${STATUS_COLORS[k]}"></span>`)
      .join("");
    const label = b.bucket_type === "paper_level" ? "论文级" : b.bucket_id.replace(/^sample_/, "");
    chip.innerHTML =
      `<span class="bc-type">${b.bucket_type === "paper_level" ? "PAPER" : "SAMPLE"}</span>
       <span class="bc-title">${esc(label)}</span>
       <span class="bc-mini">${segs}</span>`;
    chip.title = `${b.field_count} 字段`;
    chip.addEventListener("click", () => { ui.activeBucketId = b.bucket_id; render(); });
    frag.appendChild(chip);
  }
  el.bucketRail.replaceChildren(frag);
}

// ---- Center: fields list --------------------------------------------------
function fieldMatchesFilter(f) {
  const st = store.statusOf(f.field_id);
  if (ui.filterStatus) {
    if (ui.filterStatus === "no_evidence") { if (!f.no_evidence) return false; }
    else if (ui.filterStatus === "added") { return false; } // handled separately
    else if (st !== ui.filterStatus) return false;
  }
  if (ui.search) {
    const hay = (f.path + " " + (store.currentValue(f) ?? "")).toLowerCase();
    if (!hay.includes(ui.search.toLowerCase())) return false;
  }
  return true;
}

function renderFields() {
  const bucket = store.data.buckets.find((b) => b.bucket_id === ui.activeBucketId);
  if (!bucket) { el.fieldsList.innerHTML = ""; return; }

  const fieldSet = new Set(bucket.field_ids);
  const bucketFields = store.data.fields.filter((f) => fieldSet.has(f.field_id));

  // group by section, in the record's authored order
  const order = bucket.section_order.length ? bucket.section_order : [...new Set(bucketFields.map((f) => f.section))];
  const bySection = {};
  for (const f of bucketFields) (bySection[f.section] ||= []).push(f);

  const frag = document.createDocumentFragment();
  let shown = 0;

  const addedForBucket = store.doc.added_fields.filter((a) => a.bucket_id === bucket.bucket_id);

  for (const section of order) {
    const list = (bySection[section] || []).filter(fieldMatchesFilter);
    const added = ui.filterStatus && ui.filterStatus !== "added" ? [] :
                  addedForBucket.filter((a) => a.section === section);
    if (!list.length && !added.length) continue;

    const group = document.createElement("div");
    group.className = "section-group";
    const head = document.createElement("div");
    head.className = "section-head";
    head.textContent = `${SECTION_LABELS[section] || section} · ${list.length + added.length}`;
    group.appendChild(head);

    for (const f of list) { group.appendChild(fieldRow(f)); shown++; }
    for (const a of added) { group.appendChild(addedRow(a)); shown++; }
    frag.appendChild(group);
  }

  // "add field" affordance for this bucket
  const addBar = document.createElement("button");
  addBar.className = "btn ghost";
  addBar.style.margin = "6px 6px";
  addBar.textContent = "＋ 补充字段到该 bucket";
  addBar.addEventListener("click", () => promptAddField(bucket));
  frag.appendChild(addBar);

  if (!shown) {
    const empty = document.createElement("div");
    empty.className = "inspector-empty";
    empty.textContent = "没有符合筛选条件的字段。";
    frag.insertBefore(empty, frag.firstChild);
  }
  el.fieldsList.replaceChildren(frag);
}

function fieldRow(f) {
  const st = store.statusOf(f.field_id);
  const row = document.createElement("div");
  row.className = "field-row" + (f.field_id === ui.selectedFieldId ? " selected" : "");
  row.dataset.status = st;
  row.dataset.fieldId = f.field_id;

  const val = store.currentValue(f);
  const refs = store.effectiveRefs(f);

  const badges = [];
  badges.push(`<span class="badge ${evClass(f.support_label)}" title="${evLabelText(f.support_label)}">${evLabelText(f.support_label)}</span>`);
  if (typeof f.confidence === "number")
    badges.push(`<span class="badge conf" title="置信度">${f.confidence.toFixed(2)}</span>`);
  if (f.contradiction) badges.push(`<span class="badge contra">冲突</span>`);
  badges.push(`<span class="badge refct" title="证据块数量">⛬ ${refs.length}</span>`);

  row.innerHTML = `
    <div class="status-bar"></div>
    <div class="field-main">
      <div class="field-key">${esc(f.label)}</div>
      <div class="field-val ${val === "" || val == null ? "empty" : ""}">${val === "" || val == null ? "（空）" : esc(val)}</div>
      <div class="field-quick">
        <button class="qbtn on-confirm" data-act="confirmed">确认</button>
        <button class="qbtn on-review" data-act="needs_review">待复核</button>
        <button class="qbtn on-conflict" data-act="conflict">冲突</button>
      </div>
    </div>
    <div class="field-badges">${badges.join("")}</div>`;

  row.addEventListener("click", (e) => {
    if (e.target.classList.contains("qbtn")) {
      store.setStatus(f.field_id, e.target.dataset.act);
      e.stopPropagation();
      return;
    }
    selectField(f.field_id);
  });
  return row;
}

function addedRow(a) {
  const row = document.createElement("div");
  row.className = "field-row";
  row.dataset.status = "added";
  row.innerHTML = `
    <div class="status-bar"></div>
    <div class="field-main">
      <div class="field-key">＋ ${esc(a.path || "(new)")}</div>
      <div class="field-val">${esc(a.value)}</div>
    </div>
    <div class="field-badges"><span class="badge" style="background:var(--st-added);color:#fff">补充</span></div>`;
  row.addEventListener("click", () => {
    if (confirm("删除这个补充字段？")) store.removeAddedField(a.temp_id);
  });
  return row;
}

// ---- selection + highlight ------------------------------------------------
function selectField(fid) {
  ui.selectedFieldId = fid;
  ui.evIndex = 0;
  const f = store.fieldIndex[fid];
  highlightEvidence(store.effectiveRefs(f), { scroll: true });
  render();
}

function highlightEvidence(refs, { scroll } = {}) {
  el.sourceBlocks.querySelectorAll(".hl-active,.hl-multi,.hl-pulse")
    .forEach((n) => n.classList.remove("hl-active", "hl-multi", "hl-pulse"));

  if (ui.tab !== "source") switchTab("source");

  if (!refs || !refs.length) {
    el.evidenceStatus.textContent = "该字段无证据引用";
    return;
  }
  const found = [];
  refs.forEach((rid, i) => {
    const node = el.sourceBlocks.querySelector(`[data-block-id="${CSS.escape(rid)}"]`);
    if (node) {
      node.classList.add(i === ui.evIndex ? "hl-active" : "hl-multi");
      found.push(node);
    }
  });
  const missing = refs.length - found.length;
  el.evidenceStatus.textContent =
    `证据 ${refs.length} 块` + (missing ? ` · ${missing} 块无法定位` : "") +
    (refs.length > 1 ? `（第 ${ui.evIndex + 1}/${refs.length}）` : "");

  const target = el.sourceBlocks.querySelector(`[data-block-id="${CSS.escape(refs[ui.evIndex] || refs[0])}"]`) || found[0];
  if (target && scroll) {
    target.classList.add("hl-pulse");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function cycleEvidence(dir) {
  const f = store.fieldIndex[ui.selectedFieldId];
  if (!f) return;
  const refs = store.effectiveRefs(f);
  if (refs.length < 2) return;
  ui.evIndex = (ui.evIndex + dir + refs.length) % refs.length;
  highlightEvidence(refs, { scroll: true });
  renderInspector();
}

// ---- Right: inspector -----------------------------------------------------
function renderInspector() {
  const fid = ui.selectedFieldId;
  if (!fid || !store.fieldIndex[fid]) {
    el.inspector.innerHTML = `<div class="inspector-empty">选择一个字段以查看证据、置信度与编辑选项。</div>`;
    return;
  }
  const f = store.fieldIndex[fid];
  const a = store.fieldAnnot(fid);
  const st = store.statusOf(fid);
  const val = store.currentValue(f);
  const refs = store.effectiveRefs(f);
  const changed = val !== f.value;

  const evHtml = refs.length
    ? `<div class="evidence-list">` + refs.map((rid, i) => {
        const blk = store.blockIndex[rid];
        const active = i === ui.evIndex ? ' style="border-color:var(--accent)"' : "";
        return `<div class="ev-item" data-ref="${esc(rid)}" data-idx="${i}"${active}>
            <div class="ev-head"><span>${esc(rid)}</span><span>${blk ? "点击定位" : "⚠ 未找到"}</span></div>
            <div class="ev-text">${blk ? esc(blk.text.slice(0, 260)) : "该证据块不在原文中"}</div>
          </div>`;
      }).join("") + `</div>`
    : `<div class="ev-empty">⚠ 该字段没有 evidence_ref。请人工核对来源，或在下方编辑证据块 ID。</div>`;

  el.inspector.innerHTML = `
    <div class="insp-path">${esc(f.path)}</div>

    <div class="insp-label">当前值</div>
    <div class="insp-value"><textarea id="insp-val">${esc(val)}</textarea></div>
    ${changed ? `<div class="insp-orig">原始值：${esc(f.value)}</div>` : ""}

    <div class="insp-actions">
      <button class="btn confirm ${st === "confirmed" ? "active" : ""}" data-act="confirmed">✓ 确认</button>
      <button class="btn review ${st === "needs_review" ? "active" : ""}" data-act="needs_review">⚑ 待复核</button>
      <button class="btn conflict ${st === "conflict" ? "active" : ""}" data-act="conflict">✕ 冲突</button>
      <button class="btn reset" data-act="reset">重置</button>
    </div>

    <div class="insp-label">证据 (evidence_ref)</div>
    ${evHtml}
    <div style="margin-top:6px"><input id="insp-refs" value="${esc(refs.join(", "))}"
       placeholder="逗号分隔的 block id" style="width:100%;padding:6px 8px;border:1px solid var(--line-strong);border-radius:6px;font-family:var(--mono);font-size:12px"/></div>

    <div class="insp-label">支持度诊断</div>
    <div class="insp-support">
      <div>判定：<b>${evLabelText(f.support_label)}</b>${f.contradiction ? " · <b style='color:var(--st-conflict)'>存在冲突</b>" : ""}</div>
      <div>置信度：<b>${typeof f.confidence === "number" ? f.confidence.toFixed(2) : "—"}</b> · 方法：${esc(f.method || "—")}</div>
      ${f.reason ? `<div style="margin-top:4px;color:var(--ink-soft)">${esc(f.reason)}</div>` : ""}
    </div>

    <div class="insp-label">备注</div>
    <div class="insp-note"><textarea id="insp-note" placeholder="记录判断依据、疑问或给复核人的说明…">${esc(a.note || "")}</textarea></div>

    <div class="insp-label">状态</div>
    <div class="insp-support">当前：<b style="color:${STATUS_COLORS[st]}">${STATUS_LABELS[st]}</b></div>
  `;

  // wiring
  const valBox = $("#insp-val");
  valBox.addEventListener("change", () => store.setValue(fid, valBox.value));
  valBox.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { store.setValue(fid, valBox.value); e.preventDefault(); }
  });
  $("#insp-note").addEventListener("change", (e) => store.setNote(fid, e.target.value));
  $("#insp-refs").addEventListener("change", (e) => {
    const arr = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
    store.setRefsOverride(fid, arr);
    ui.evIndex = 0;
    highlightEvidence(arr, { scroll: true });
  });
  el.inspector.querySelectorAll(".insp-actions .btn").forEach((b) =>
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "reset") { store.setStatus(fid, "unprocessed"); if (valBox.value !== f.value) store.setValue(fid, f.value); }
      else store.setStatus(fid, act);
    }));
  el.inspector.querySelectorAll(".ev-item").forEach((item) =>
    item.addEventListener("click", () => {
      ui.evIndex = Number(item.dataset.idx);
      highlightEvidence(refs, { scroll: true });
      renderInspector();
    }));
}

// ---- add field ------------------------------------------------------------
function promptAddField(bucket) {
  const sections = bucket.section_order.length ? bucket.section_order : ["unmapped_findings"];
  const section = prompt(`补充字段所属 section：\n可选：${sections.join(", ")}`, sections[0]);
  if (!section) return;
  const key = prompt("字段路径/键（例如 properties[2].value 或自定义键）：", "");
  if (key == null) return;
  const value = prompt("字段值：", "");
  if (value == null) return;
  const path = `${section}.${key}`;
  store.addField({ bucket_id: bucket.bucket_id, section, path, value });
  toast("已补充字段");
}

// ===========================================================================
// Global controls / tabs / keyboard / dividers
// ===========================================================================
function wireGlobalControls() {
  el.paperSelect.addEventListener("change", async (e) => {
    await store.flush();
    await loadPaper(e.target.value);
  });
  el.undo.addEventListener("click", () => store.undo());
  el.redo.addEventListener("click", () => store.redo());
  el.taskStatus.addEventListener("change", (e) => store.setTaskStatus(e.target.value));
  el.export.addEventListener("click", onExport);
  el.help.addEventListener("click", () => el.helpModal.classList.remove("hidden"));
  el.helpClose.addEventListener("click", () => el.helpModal.classList.add("hidden"));
  el.helpModal.addEventListener("click", (e) => { if (e.target === el.helpModal) el.helpModal.classList.add("hidden"); });

  el.fieldSearch.addEventListener("input", (e) => { ui.search = e.target.value; renderFields(); });
  el.filterStatus.addEventListener("change", (e) => { ui.filterStatus = e.target.value; renderFields(); });

  document.querySelectorAll("#source-tabs .tab").forEach((t) =>
    t.addEventListener("click", () => switchTab(t.dataset.tab)));

  window.addEventListener("beforeunload", (e) => {
    if (store.saveState === "dirty" || store.saveState === "saving") {
      store.flush(); e.preventDefault(); e.returnValue = "";
    }
  });
}

function switchTab(tab) {
  ui.tab = tab;
  document.querySelectorAll("#source-tabs .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tab));
  el.sourceBlocks.classList.toggle("hidden", tab !== "source");
  el.knowledgeView.classList.toggle("hidden", tab !== "knowledge");
}

async function onExport() {
  await store.flush();
  const total = store.progress();
  const unreviewed = total.total - total.done;
  if (unreviewed > 0 &&
      !confirm(`还有 ${unreviewed} 个字段未审核（未确认/未修改）。仍要导出吗？`)) return;
  window.location.href = api.exportUrl(store.paperId);
  toast("正在生成导出包…");
}

function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) &&
                   !(e.metaKey || e.ctrlKey);
    // global (work even while typing when using modifier)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); store.undo(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); store.redo(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); store.flush(); toast("已保存"); return; }
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
      case "e": if (ui.selectedFieldId) { const t = $("#insp-val"); if (t) { t.focus(); e.preventDefault(); } } break;
      case "n": cycleEvidence(1); break;
      case "N": cycleEvidence(-1); break;
      case "Escape": el.helpModal.classList.add("hidden"); break;
    }
  });
}

function moveSelection(dir) {
  const rows = [...el.fieldsList.querySelectorAll(".field-row[data-field-id]")];
  if (!rows.length) return;
  let idx = rows.findIndex((r) => r.dataset.fieldId === ui.selectedFieldId);
  idx = Math.max(0, Math.min(rows.length - 1, idx + dir));
  const fid = rows[idx].dataset.fieldId;
  selectField(fid);
  rows[idx].scrollIntoView({ block: "nearest" });
}

function wireDividers() {
  const drag = (divider, targetPane, side) => {
    let startX, startW;
    divider.addEventListener("mousedown", (e) => {
      startX = e.clientX; startW = targetPane.getBoundingClientRect().width;
      const move = (ev) => {
        const dx = ev.clientX - startX;
        const w = side === "left" ? startW + dx : startW - dx;
        targetPane.style.flex = `0 0 ${Math.max(220, w)}px`;
      };
      const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
    });
  };
  drag($("#divider-1"), $("#pane-source"), "left");
  drag($("#divider-2"), $("#pane-inspector"), "right");
}

// ---- legend + help --------------------------------------------------------
function buildLegend() {
  const items = [
    ["unprocessed", "未处理"], ["confirmed", "已确认"], ["modified", "已修改"],
    ["needs_review", "待复核"], ["conflict", "冲突"], ["added", "已补充"],
  ];
  el.legend.innerHTML =
    `<span style="font-weight:600;color:var(--ink)">状态图例：</span>` +
    items.map(([k, label]) =>
      `<span class="legend-item"><span class="legend-dot" style="background:${STATUS_COLORS[k]}"></span>${label}</span>`
    ).join("") +
    `<span class="legend-item" style="margin-left:auto"><span class="badge ev-none">缺证据</span></span>
     <span class="legend-item"><span class="badge ev-weak">弱证据</span></span>
     <span class="legend-item"><span class="badge ev-strong">证据充分</span></span>
     <span class="legend-item">徽章=证据质量（次级维度），颜色=审核状态（主维度）</span>`;
}

function buildHelp() {
  el.helpBody.innerHTML = `
    <p>本工具用于人工审核结构化抽取结果。<b>颜色</b>只表示“审核状态”（一个维度），<b>徽章</b>表示“证据质量/置信度”（次级维度），以此避免颜色过载。</p>
    <h3>快捷键</h3>
    <table>
      <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>下一个 / 上一个字段</td></tr>
      <tr><td><kbd>c</kbd></td><td>确认当前字段</td></tr>
      <tr><td><kbd>x</kbd></td><td>标记冲突</td></tr>
      <tr><td><kbd>r</kbd></td><td>标记待复核</td></tr>
      <tr><td><kbd>e</kbd></td><td>编辑当前值</td></tr>
      <tr><td><kbd>n</kbd> / <kbd>N</kbd></td><td>切换多证据（下一个/上一个）</td></tr>
      <tr><td><kbd>/</kbd></td><td>聚焦搜索框</td></tr>
      <tr><td><kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd></td><td>撤销</td></tr>
      <tr><td><kbd>⌘/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>重做</td></tr>
      <tr><td><kbd>⌘/Ctrl</kbd>+<kbd>S</kbd></td><td>立即保存</td></tr>
      <tr><td><kbd>⌘/Ctrl</kbd>+<kbd>P</kbd></td><td>切换论文</td></tr>
      <tr><td><kbd>?</kbd></td><td>打开/关闭本帮助</td></tr>
    </table>
    <h3>工作流</h3>
    <p>选择字段 → 左侧自动高亮证据 → 核对/修改值 → 确认或标记 → 自动保存 → 完成后导出。</p>`;
}

// ---- tiny markdown (knowledge tab only, trusted local content) -----------
function miniMarkdown(md) {
  const lines = md.split("\n");
  let html = "", inCode = false, inList = false;
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith("```")) {
      inCode = !inCode; html += inCode ? "<pre>" : "</pre>"; continue;
    }
    if (inCode) { html += esc(line) + "\n"; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { if (inList) { html += "</ul>"; inList = false; } html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (line.trim() === "") { html += ""; } else { html += `<p>${inline(line)}</p>`; }
  }
  if (inList) html += "</ul>";
  if (inCode) html += "</pre>";
  return html;
}

boot();
