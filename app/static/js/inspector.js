// Right panel: single-field detail / editor.
import { el, ui } from "./dom.js";
import { store } from "./store.js";
import { highlightEvidence } from "./source.js";
import { STATUS_LABELS, STATUS_COLORS, esc, evLabelText } from "./util.js";

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
        const active = i === ui.evIndex ? ' style="border-color:var(--accent)"' : "";
        return `<div class="ev-item" data-idx="${i}"${active}>
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
    <div class="insp-support">当前：<b style="color:${STATUS_COLORS[st]}">${STATUS_LABELS[st]}</b></div>`;

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
