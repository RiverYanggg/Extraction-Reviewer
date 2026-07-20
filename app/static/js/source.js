// Left panel: evidence-block source, PDF tab, evidence highlighting.
import { el, ui } from "./dom.js";
import { store } from "./store.js";
import { bus } from "./bus.js";
import { getLatexToggleState, hasEvidenceBlocks, renderEvidenceMath } from "./latex.js";

function updateLatexToggle(errors = 0) {
  const state = getLatexToggleState(ui.latexMode, ui.latexAvailable, errors);
  el.latexToggle.disabled = state.disabled;
  el.latexToggle.textContent = state.text;
  el.latexToggle.title = state.title;
  el.latexToggle.setAttribute("aria-pressed", String(state.pressed));
  el.latexToggle.setAttribute("aria-label", state.label);
}

function updateEvidenceStatus(text) {
  const suffix = ui.latexErrors ? `公式解析错误 ${ui.latexErrors} 处` : "";
  el.evidenceStatus.textContent = [text, suffix].filter(Boolean).join(" · ");
}

function buildSourceBlocks() {
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
      img.onerror = () => img.replaceWith(document.createTextNode(`🖼 ${b.image_src}`));
      div.appendChild(img);
    } else {
      const txt = document.createElement("span");
      txt.textContent = b.kind === "heading" ? b.heading_text : b.text;
      div.appendChild(txt);
    }
    div.addEventListener("click", () => selectFirstFieldCiting(b.block_id));
    frag.appendChild(div);
  }
  el.sourceBlocks.replaceChildren(frag);
}

export function renderSourceBlocks() {
  if (!hasEvidenceBlocks(store.data)) {
    ui.latexAvailable = null;
    ui.latexErrors = 0;
    el.sourceBlocks.replaceChildren();
    updateLatexToggle();
    updateEvidenceStatus("");
    return false;
  }

  buildSourceBlocks();

  if (ui.latexMode === "rendered") {
    const result = renderEvidenceMath(el.sourceBlocks);
    ui.latexAvailable = result.available;
    ui.latexErrors = result.errors;
    if (!result.available) ui.latexMode = "source";
    if (result.fatal) {
      ui.latexMode = "source";
      buildSourceBlocks();
      el.sourceBlocks.classList.add("latex-has-errors");
    }
    updateLatexToggle(result.errors);
  } else {
    ui.latexErrors = 0;
    el.sourceBlocks.classList.remove("latex-has-errors");
    updateLatexToggle();
  }
  if (!ui.selectedFieldId) updateEvidenceStatus("");
  return true;
}

export function setLatexMode(mode) {
  if (mode !== "rendered" && mode !== "source") return;
  ui.latexMode = mode;
  if (!renderSourceBlocks()) return;

  const field = store.fieldIndex[ui.selectedFieldId];
  if (field) highlightEvidence(store.effectiveRefs(field), { scroll: false });
}

function selectFirstFieldCiting(blockId) {
  const f = store.data.fields.find((f) => store.effectiveRefs(f).includes(blockId));
  if (f) bus.selectField(f.field_id);
}

export function preparePdf() {
  el.pdfView.innerHTML = store.data.has_pdf
    ? ""
    : `<div class="pdf-empty">本论文没有可用的 PDF 原文文件。</div>`;
  ui.pdfLoaded = false;
}

function ensurePdfLoaded() {
  if (ui.pdfLoaded || !store.data.has_pdf) return;
  const frame = document.createElement("iframe");
  frame.src = store.data.pdf_url;
  frame.title = "PDF";
  el.pdfView.replaceChildren(frame);
  ui.pdfLoaded = true;
}

export function switchTab(tab) {
  ui.tab = tab;
  document.querySelectorAll("#source-tabs .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tab));
  el.sourceBlocks.classList.toggle("hidden", tab !== "source");
  el.pdfView.classList.toggle("hidden", tab !== "pdf");
  if (tab === "pdf") ensurePdfLoaded();
}

export function highlightEvidence(refs, { scroll } = {}) {
  el.sourceBlocks.querySelectorAll(".hl-active,.hl-multi,.hl-pulse")
    .forEach((n) => n.classList.remove("hl-active", "hl-multi", "hl-pulse"));

  if (ui.tab !== "source") switchTab("source");

  if (!refs || !refs.length) {
    updateEvidenceStatus("该字段无证据引用");
    return;
  }
  const found = [];
  refs.forEach((rid, i) => {
    const node = el.sourceBlocks.querySelector(`[data-block-id="${CSS.escape(rid)}"]`);
    if (node) { node.classList.add(i === ui.evIndex ? "hl-active" : "hl-multi"); found.push(node); }
  });
  const missing = refs.length - found.length;
  updateEvidenceStatus(
    `证据 ${refs.length} 块` + (missing ? ` · ${missing} 块无法定位` : "") +
    (refs.length > 1 ? `（第 ${ui.evIndex + 1}/${refs.length}）` : ""));

  const target = el.sourceBlocks.querySelector(`[data-block-id="${CSS.escape(refs[ui.evIndex] || refs[0])}"]`) || found[0];
  if (target && scroll) {
    target.classList.add("hl-pulse");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function cycleEvidence(dir) {
  const f = store.fieldIndex[ui.selectedFieldId];
  if (!f) return;
  const refs = store.effectiveRefs(f);
  if (refs.length < 2) return;
  ui.evIndex = (ui.evIndex + dir + refs.length) % refs.length;
  highlightEvidence(refs, { scroll: true });
  bus.render();
}
