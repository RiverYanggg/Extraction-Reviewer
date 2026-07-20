// Middle panel: bucket rail + collapsible JSON tree + add-field + JSON preview.
import { el, ui } from "./dom.js";
import { store } from "./store.js";
import { bus } from "./bus.js";
import { STATUS_COLORS, SECTION_LABELS, esc, toast } from "./util.js";

export function activeBucket() {
  return store.data.buckets.find((b) => b.bucket_id === ui.activeBucketId);
}

// collect descendant leaf field_ids for a node or a tree (array)
function collectLeaves(node, acc = []) {
  const nodes = Array.isArray(node) ? node : [node];
  for (const n of nodes) {
    if (n.kind === "leaf") acc.push(n.field_id);
    else for (const c of n.children || []) collectLeaves(c, acc);
  }
  return acc;
}

// collect every non-leaf node id across all buckets, so a freshly loaded
// paper starts fully collapsed and the tree opens one level at a time.
export function allGroupIds() {
  const ids = [];
  const walk = (node) => {
    if (node.kind === "leaf") return;
    if (node.id != null) ids.push(node.id);
    for (const c of node.children || []) walk(c);
  };
  for (const b of store.data?.buckets || []) for (const n of b.tree) walk(n);
  return ids;
}

// ---- bucket rail ----------------------------------------------------------
export function renderBucketRail() {
  const frag = document.createDocumentFragment();
  for (const b of store.data.buckets) {
    const chip = document.createElement("div");
    chip.className = "bucket-chip" + (b.bucket_id === ui.activeBucketId ? " active" : "");
    const leaves = collectLeaves(b.tree);
    const dist = { confirmed: 0, modified: 0, conflict: 0, needs_review: 0, unprocessed: 0 };
    for (const fid of leaves) dist[store.statusOf(fid)]++;
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
    chip.addEventListener("click", () => { ui.activeBucketId = b.bucket_id; bus.render(); });
    frag.appendChild(chip);
  }
  el.bucketRail.replaceChildren(frag);
}

// ---- tree -----------------------------------------------------------------
function leafVisible(field) {
  const st = store.statusOf(field.field_id);
  if (ui.filterStatus) {
    if (ui.filterStatus === "no_evidence") { if (!field.no_evidence) return false; }
    else if (ui.filterStatus === "added") return false;
    else if (st !== ui.filterStatus) return false;
  }
  if (ui.search) {
    const hay = (field.path + " " + (store.currentValue(field) ?? "")).toLowerCase();
    if (!hay.includes(ui.search.toLowerCase())) return false;
  }
  return true;
}

export function renderFields() {
  const bucket = activeBucket();
  if (!bucket) { el.fieldsList.innerHTML = ""; return; }
  const filtering = !!(ui.search || (ui.filterStatus && ui.filterStatus !== "added"));
  const scrollTop = el.fieldsScroll.scrollTop;

  const frag = document.createDocumentFragment();
  let shown = 0;
  for (const node of bucket.tree) {
    const r = renderNode(node, 0, bucket, filtering);
    if (r) { frag.appendChild(r); shown++; }
  }
  const rootAdded = store.doc.added_fields.filter((a) => a.bucket_id === bucket.bucket_id && !a.parent_id);
  if ((!ui.filterStatus || ui.filterStatus === "added") && rootAdded.length) {
    const box = document.createElement("div");
    box.className = "tguide";
    for (const a of rootAdded) box.appendChild(addedLeaf(a));
    frag.appendChild(box);
  }
  const addBar = document.createElement("button");
  addBar.className = "btn ghost";
  addBar.style.margin = "8px 6px";
  addBar.textContent = "＋ 补充字段到该 bucket 根";
  addBar.addEventListener("click", () =>
    openAddForm(addBar, { bucket, parent_id: null, section: bucket.tree[0]?.key || "unmapped_findings", label_path: "" }));
  frag.appendChild(addBar);

  if (!shown && filtering) {
    const empty = document.createElement("div");
    empty.className = "inspector-empty";
    empty.textContent = "没有符合筛选条件的字段。";
    frag.insertBefore(empty, frag.firstChild);
  }
  el.fieldsList.replaceChildren(frag);
  el.fieldsScroll.scrollTop = scrollTop;
}

function renderNode(node, depth, bucket, filtering) {
  if (node.kind === "leaf") {
    const f = store.fieldIndex[node.field_id];
    if (!f) return null;
    if (filtering && !leafVisible(f)) return null;
    return leafRow(f, node.label, depth);
  }
  const leaves = collectLeaves(node);
  const visibleLeaves = filtering
    ? leaves.filter((fid) => store.fieldIndex[fid] && leafVisible(store.fieldIndex[fid]))
    : leaves;
  const showAdded = !ui.filterStatus || ui.filterStatus === "added";
  const addedHere = showAdded ? store.doc.added_fields.filter((a) => a.parent_id === node.id) : [];
  if (filtering && !visibleLeaves.length && !addedHere.length) return null;

  const wrap = document.createElement("div");
  const collapsed = ui.collapsed.has(node.id) && !filtering;

  const head = document.createElement("div");
  head.className = `tgroup ${node.kind}` + (collapsed ? " collapsed" : "");
  head.style.paddingLeft = 4 + depth * 12 + "px";
  const dist = { confirmed: 0, modified: 0, needs_review: 0, conflict: 0, added: 0, unprocessed: 0 };
  for (const fid of leaves) dist[store.statusOf(fid)]++;
  for (const _ of addedHere) dist.added++;
  const segs = ["confirmed", "modified", "needs_review", "conflict", "added", "unprocessed"]
    .filter((k) => dist[k])
    .map((k) => `<span class="bc-seg" style="flex:${dist[k]};background:${STATUS_COLORS[k]}"></span>`)
    .join("");
  head.innerHTML = `
    <span class="tw">▾</span>
    <span class="tlabel">${esc(node.label)}</span>
    <span class="tcount">${leaves.length}${addedHere.length ? "+" + addedHere.length : ""}</span>
    <span class="tmini">${segs}</span>
    <button class="tadd" title="在此补充字段">＋</button>`;
  wrap.appendChild(head);

  const kids = document.createElement("div");
  kids.className = "tchildren tguide" + (collapsed ? " collapsed" : "");
  for (const c of node.children || []) {
    const r = renderNode(c, depth + 1, bucket, filtering);
    if (r) kids.appendChild(r);
  }
  for (const a of addedHere) kids.appendChild(addedLeaf(a));
  wrap.appendChild(kids);

  head.addEventListener("click", (e) => {
    if (e.target.classList.contains("tadd")) {
      e.stopPropagation();
      openAddForm(head, {
        bucket, parent_id: node.id,
        section: node.kind === "section" ? node.key : sectionOfNode(bucket, node),
        label_path: node.label,
      });
      return;
    }
    if (filtering) return;
    if (ui.collapsed.has(node.id)) ui.collapsed.delete(node.id);
    else ui.collapsed.add(node.id);
    head.classList.toggle("collapsed");
    kids.classList.toggle("collapsed");
  });
  return wrap;
}

function sectionOfNode(bucket, target) {
  const walk = (node, sec) => {
    if (node === target) return sec;
    for (const c of node.children || []) {
      const r = walk(c, node.kind === "section" ? node.key : sec);
      if (r) return r;
    }
    return null;
  };
  for (const s of bucket.tree) { const r = walk(s, s.key); if (r) return r; }
  return "unmapped_findings";
}

function leafRow(f, key, depth) {
  const st = store.statusOf(f.field_id);
  const row = document.createElement("div");
  row.className = "field-row leaf" + (f.field_id === ui.selectedFieldId ? " selected" : "");
  row.dataset.status = st;
  row.dataset.fieldId = f.field_id;
  row.style.marginLeft = 4 + depth * 12 + "px";

  const val = store.currentValue(f);
  // Evidence quality, confidence and evidence count are intentionally NOT shown
  // on the card — reviewers rarely act on them here. They live in the inspector,
  // which opens on the far right when the field is selected.
  const empty = val === "" || val == null;
  row.innerHTML = `
    <div class="status-bar"></div>
    <div class="field-main">
      <div class="field-key">${esc(key)}</div>
      <div class="field-val ${empty ? "empty" : ""}">${empty ? "（空）" : esc(val)}</div>
    </div>
    <div class="field-quick">
      <button class="qbtn on-confirm" data-act="confirmed" title="确认">确认</button>
      <button class="qbtn on-review" data-act="needs_review" title="待复核">待复核</button>
      <button class="qbtn on-conflict" data-act="conflict" title="冲突">冲突</button>
    </div>`;
  // Replay the "settled into a state" pop once, right after the status change.
  if (ui.pulseFieldId === f.field_id) {
    row.classList.add("status-pulse");
    ui.pulseFieldId = null;
  }
  row.addEventListener("click", (e) => {
    if (e.target.classList.contains("qbtn")) {
      ui.pulseFieldId = f.field_id;
      store.setStatus(f.field_id, e.target.dataset.act); e.stopPropagation(); return;
    }
    bus.selectField(f.field_id);
  });
  return row;
}

function addedLeaf(a) {
  const row = document.createElement("div");
  row.className = "field-row leaf";
  row.dataset.status = "added";
  row.innerHTML = `
    <div class="status-bar"></div>
    <div class="field-main">
      <div class="field-key">＋ ${esc(a.key || a.path || "(new)")}</div>
      <div class="field-val ${a.value === "" ? "empty" : ""}">${a.value === "" ? "（空）" : esc(a.value)}</div>
    </div>
    <div class="field-badges"><span class="badge" style="background:var(--st-added);color:#fff">补充</span>
      <span class="badge refct" title="删除">✕</span></div>`;
  row.querySelector(".refct").addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("删除这个补充字段？")) store.removeAddedField(a.temp_id);
  });
  return row;
}

function openAddForm(anchor, ctx) {
  document.querySelectorAll(".addfield-form").forEach((n) => n.remove());
  const form = document.createElement("div");
  form.className = "addfield-form";
  form.innerHTML = `
    <input class="af-key" placeholder="字段名 (key)" />
    <input class="af-val" placeholder="值 (value)" />
    <button class="af-ok">添加</button>
    <button class="af-cancel">取消</button>`;
  anchor.insertAdjacentElement("afterend", form);
  const keyBox = form.querySelector(".af-key");
  const valBox = form.querySelector(".af-val");
  keyBox.focus();
  const submit = () => {
    const key = keyBox.value.trim();
    if (!key) { keyBox.focus(); return; }
    const label_path = ctx.label_path ? `${ctx.label_path}.${key}` : `${ctx.section}.${key}`;
    store.addField({ bucket_id: ctx.bucket.bucket_id, section: ctx.section,
                     parent_id: ctx.parent_id, key, value: valBox.value, path: label_path });
    form.remove();
    toast("已补充字段");
  };
  form.querySelector(".af-ok").addEventListener("click", submit);
  form.querySelector(".af-cancel").addEventListener("click", () => form.remove());
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") form.remove();
  });
}

// ---- per-bucket JSON preview ---------------------------------------------
export function openBucketPreview() {
  const bucket = activeBucket();
  if (!bucket) return;
  const root = {};
  for (const fid of collectLeaves(bucket.tree)) {
    const f = store.fieldIndex[fid];
    if (!f) continue;
    setByPointer(root, fid.split("/"), store.currentValue(f));
  }
  compact(root);
  el.previewTitle.textContent =
    `JSON 预览 — ${bucket.bucket_type === "paper_level" ? "论文级" : bucket.bucket_id}（含 null，反映已修改值）`;
  el.previewBody.innerHTML = highlightJson(JSON.stringify(root, null, 2));
  el.previewModal.classList.remove("hidden");
}

function setByPointer(root, tokens, val) {
  let cur = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const nextIsIdx = /^\d+$/.test(tokens[i + 1]);
    if (cur[t] == null) cur[t] = nextIsIdx ? [] : {};
    cur = cur[t];
  }
  cur[tokens[tokens.length - 1]] = val;
}

function compact(o) {
  if (Array.isArray(o)) {
    for (let i = o.length - 1; i >= 0; i--) { if (o[i] === undefined) o.splice(i, 1); else compact(o[i]); }
  } else if (o && typeof o === "object") {
    for (const k in o) compact(o[k]);
  }
}

function highlightJson(s) {
  return esc(s)
    .replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)/g, '<span class="jk">$1</span>$2')
    .replace(/:\s*(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g, ': <span class="js">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="jn">$1</span>')
    .replace(/:\s*(null|true|false)/g, ': <span class="jz">$1</span>');
}
