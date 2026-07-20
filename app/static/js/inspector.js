// Right panel: single-field detail / editor.
import { el, ui } from "./dom.js";
import { store } from "./store.js";
import { highlightEvidence } from "./source.js";
import { STATUS_LABELS, STATUS_COLORS, esc, evClass, evLabelText } from "./util.js";

const $i = (sel) => el.inspector.querySelector(sel);

export function renderInspector() {
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
        const active = i === ui.evIndex ? " active" : "";
        return `<div class="ev-item${active}" data-idx="${i}" title="${blk ? "点击在左栏定位" : "该证据块不在原文中"}">
            <div class="ev-head"><span class="ev-id">${esc(rid)}</span>${blk ? "" : `<span class="ev-missing">未找到</span>`}</div>
            ${blk ? `<div class="ev-text">${esc(blk.text.slice(0, 180))}</div>` : ""}
          </div>`;
      }).join("") + `</div>`
    : `<div class="ev-empty">该字段没有 evidence_ref，请人工核对来源。</div>`;

  // Evidence-quality signals (support / confidence / contradiction) are surfaced
  // here as compact chips — they were removed from the center cards to reduce noise.
  const qualityChips = [
    `<span class="qchip ${evClass(f.support_label)}">${evLabelText(f.support_label)}</span>`,
    typeof f.confidence === "number" ? `<span class="qchip conf">置信 ${f.confidence.toFixed(2)}</span>` : "",
    f.contradiction ? `<span class="qchip contra">冲突</span>` : "",
  ].filter(Boolean).join("");

  el.inspector.innerHTML = `
    <div class="insp-head">
      <div class="insp-path" title="${esc(f.path)}">${esc(f.path)}</div>
      <span class="insp-status" style="color:${STATUS_COLORS[st]}">${STATUS_LABELS[st]}</span>
    </div>
    <div class="insp-label">当前值</div>
    <div class="insp-value"><textarea id="insp-val">${esc(val)}</textarea></div>
    ${changed ? `<div class="insp-orig">原始值：${esc(f.value)}</div>` : ""}
    <div class="insp-actions">
      <button class="btn confirm ${st === "confirmed" ? "active" : ""}" data-act="confirmed">✓ 确认</button>
      <button class="btn review ${st === "needs_review" ? "active" : ""}" data-act="needs_review">⚑ 待复核</button>
      <button class="btn conflict ${st === "conflict" ? "active" : ""}" data-act="conflict">✕ 冲突</button>
      <button class="btn reset" data-act="reset">重置</button>
    </div>
    <div class="insp-label insp-label-row">证据${qualityChips ? `<span class="qchips">${qualityChips}</span>` : ""}</div>
    ${evHtml}
    ${f.reason ? `<div class="insp-reason">${esc(f.reason)}</div>` : ""}
    <input id="insp-refs" class="insp-refs" value="${esc(refs.join(", "))}" placeholder="逗号分隔的 block id" />
    <div class="insp-label">备注</div>
    <div class="insp-note"><textarea id="insp-note" placeholder="记录判断依据或给复核人的说明…">${esc(a.note || "")}</textarea></div>`;

  const valBox = $i("#insp-val");
  valBox.addEventListener("change", () => store.setValue(fid, valBox.value));
  valBox.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { store.setValue(fid, valBox.value); e.preventDefault(); }
  });
  $i("#insp-note").addEventListener("change", (e) => store.setNote(fid, e.target.value));
  $i("#insp-refs").addEventListener("change", (e) => {
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
