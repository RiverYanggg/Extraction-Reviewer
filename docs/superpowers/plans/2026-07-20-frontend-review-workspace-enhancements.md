# Frontend Review Workspace Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add offline LaTeX evidence rendering, reliable `J/K` field-follow scrolling, and a searchable progress-aware paper picker.

**Architecture:** Preserve the current vanilla HTML/CSS/ES-module frontend. Add three focused modules (`paper-picker.js`, `navigation.js`, and `latex.js`), keep backend contracts unchanged, and isolate deterministic behavior so it can be tested with Node's built-in test runner before DOM integration.

**Tech Stack:** Vanilla JavaScript ES modules, Node `node:test`, KaTeX 0.16.22 vendored static assets, existing FastAPI/pytest backend.

---

## File Map

- Create `.gitignore`: ignore local brainstorming output, package extraction artifacts, and `node_modules`.
- Create `package.json`: declare ES-module mode and the frontend test command.
- Create `tests/frontend/paper-picker.test.js`: paper state, sequence, and filtering tests.
- Create `tests/frontend/navigation.test.js`: viewport visibility tests.
- Create `tests/frontend/latex.test.js`: KaTeX configuration, fallback, and asset-presence tests.
- Create `app/static/js/paper-picker.js`: deterministic paper-summary helpers and the accessible picker component.
- Create `app/static/js/navigation.js`: field-row viewport calculation and scrolling helper.
- Create `app/static/js/latex.js`: safe KaTeX invocation and source fallback.
- Create `app/static/vendor/katex/`: vendored KaTeX distribution including fonts and auto-render extension.
- Modify `app/static/index.html`: replace the native paper `<select>`, add the formula-mode toggle, and load KaTeX assets.
- Modify `app/static/js/dom.js`: expose the new picker and formula-toggle elements and add LaTeX UI state.
- Modify `app/static/js/app.js`: initialize the picker, synchronize progress, wire shortcuts, and use the new navigation helper.
- Modify `app/static/js/source.js`: render formulas after building evidence blocks and support source/rendered switching.
- Modify `app/static/css/style.css`: style the picker, task-state colors, formula toggle, and render errors.
- Modify `docs/user_manual.md`: document formula mode and the enhanced paper picker.

## Task 1: Frontend Test Harness and Repository Hygiene

**Files:**
- Create: `.gitignore`
- Create: `package.json`

- [ ] **Step 1: Add the frontend test command**

Create `package.json`:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test:frontend": "node --test tests/frontend/*.test.js"
  }
}
```

- [ ] **Step 2: Ignore local-only artifacts**

Create `.gitignore`:

```gitignore
.superpowers/
node_modules/
katex-*.tgz
package/
```

- [ ] **Step 3: Run the empty frontend suite**

Run: `npm run test:frontend`

Expected: exit code 1 because `tests/frontend/*.test.js` does not exist yet. This confirms the command is active rather than silently skipping tests.

- [ ] **Step 4: Commit the harness**

```bash
git add .gitignore package.json
git commit -m "test: add frontend test harness"
```

## Task 2: Paper Summary Model

**Files:**
- Create: `tests/frontend/paper-picker.test.js`
- Create: `app/static/js/paper-picker.js`

- [ ] **Step 1: Write failing paper-summary tests**

Create `tests/frontend/paper-picker.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  derivePaperState,
  filterPapers,
  formatPaperSequence,
} from "../../app/static/js/paper-picker.js";

test("derivePaperState maps paper progress to one visual state", () => {
  assert.deepEqual(derivePaperState({ pct: 0, task_status: "not_started" }),
    { key: "not-started", label: "未开始" });
  assert.deepEqual(derivePaperState({ pct: 37, task_status: "in_progress" }),
    { key: "in-progress", label: "进行中" });
  assert.deepEqual(derivePaperState({ pct: 100, task_status: "submitted" }),
    { key: "complete", label: "已完成" });
  assert.deepEqual(derivePaperState({ pct: 80, task_status: "submitted" }),
    { key: "inconsistent", label: "提交异常" });
});

test("formatPaperSequence uses at least two digits", () => {
  assert.equal(formatPaperSequence(0), "01");
  assert.equal(formatPaperSequence(8), "09");
  assert.equal(formatPaperSequence(99), "100");
});

test("filterPapers matches title and DOI case-insensitively", () => {
  const papers = [
    { paper_id: "10.1016/J.MATLET.2024.136522", title: "Effect of Cu Addition" },
    { paper_id: "10.1016/j.msea.2007.01.014", title: "Fe-Al tensile properties" },
  ];
  assert.deepEqual(filterPapers(papers, "cu").map((p) => p.paper_id), [papers[0].paper_id]);
  assert.deepEqual(filterPapers(papers, "msea").map((p) => p.paper_id), [papers[1].paper_id]);
  assert.equal(filterPapers(papers, "missing").length, 0);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm run test:frontend`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `app/static/js/paper-picker.js`.

- [ ] **Step 3: Implement the minimal paper-summary helpers**

Create `app/static/js/paper-picker.js` with these exports before adding the DOM component:

```js
export function derivePaperState(progress = {}) {
  const pct = Number(progress.pct) || 0;
  if (progress.task_status === "submitted" && pct < 100) {
    return { key: "inconsistent", label: "提交异常" };
  }
  if (pct >= 100) return { key: "complete", label: "已完成" };
  if (pct > 0) return { key: "in-progress", label: "进行中" };
  return { key: "not-started", label: "未开始" };
}

export function formatPaperSequence(index) {
  return String(index + 1).padStart(2, "0");
}

export function filterPapers(papers, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return papers;
  return papers.filter((paper) =>
    `${paper.title || ""} ${paper.paper_id || ""}`.toLowerCase().includes(needle));
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npm run test:frontend`

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Commit the paper-summary model**

```bash
git add tests/frontend/paper-picker.test.js app/static/js/paper-picker.js
git commit -m "test: define paper picker states"
```

## Task 3: Searchable Paper Picker Component

**Files:**
- Modify: `app/static/js/paper-picker.js`
- Modify: `app/static/index.html`
- Modify: `app/static/js/dom.js`
- Modify: `app/static/js/app.js`
- Modify: `app/static/css/style.css`

- [ ] **Step 1: Extend the test with progress-summary normalization**

Append to `tests/frontend/paper-picker.test.js`:

```js
import { normalizePaperSummary } from "../../app/static/js/paper-picker.js";

test("normalizePaperSummary exposes reviewed counts and visual state", () => {
  assert.deepEqual(normalizePaperSummary({
    paper_id: "10.test/example",
    title: "Example",
    progress: { done: 3, total: 8, pct: 38, task_status: "in_progress" },
  }, 1), {
    paper_id: "10.test/example",
    title: "Example",
    sequence: "02",
    done: 3,
    total: 8,
    pct: 38,
    state: { key: "in-progress", label: "进行中" },
  });
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `node --test tests/frontend/paper-picker.test.js`

Expected: FAIL because `normalizePaperSummary` is not exported.

- [ ] **Step 3: Add summary normalization and the picker class**

Add to `paper-picker.js`:

```js
export function normalizePaperSummary(paper, index) {
  const progress = paper.progress || {};
  return {
    paper_id: paper.paper_id,
    title: paper.title || paper.paper_id,
    sequence: formatPaperSequence(index),
    done: Number(progress.done) || 0,
    total: Number(progress.total) || 0,
    pct: Number(progress.pct) || 0,
    state: derivePaperState(progress),
  };
}

export class PaperPicker {
  constructor({ root, trigger, menu, search, list, onSelect, onError = () => {} }) {
    this.root = root;
    this.trigger = trigger;
    this.menu = menu;
    this.search = search;
    this.list = list;
    this.onSelect = onSelect;
    this.onError = onError;
    this.papers = [];
    this.selectedId = null;
    this.activeIndex = 0;
    trigger.addEventListener("click", () => this.toggle());
    search.addEventListener("input", () => { this.activeIndex = 0; this.renderList(); });
    search.addEventListener("keydown", (event) => this.onSearchKeydown(event));
    document.addEventListener("click", (event) => {
      if (!root.contains(event.target)) this.close();
    });
  }

  setPapers(papers) {
    this.papers = papers.map(normalizePaperSummary);
    this.render();
  }

  setSelected(paperId) {
    this.selectedId = paperId;
    this.renderTrigger();
    this.renderList();
  }

  updateProgress(paperId, progress) {
    const paper = this.papers.find((item) => item.paper_id === paperId);
    if (!paper) return;
    Object.assign(paper, {
      done: Number(progress.done) || 0,
      total: Number(progress.total) || 0,
      pct: Number(progress.pct) || 0,
      state: derivePaperState(progress),
    });
    this.render();
  }

  open() {
    this.menu.classList.remove("hidden");
    this.trigger.setAttribute("aria-expanded", "true");
    this.search.value = "";
    this.activeIndex = Math.max(0, this.visiblePapers().findIndex((p) => p.paper_id === this.selectedId));
    this.renderList();
    this.search.focus();
  }

  close() {
    this.menu.classList.add("hidden");
    this.trigger.setAttribute("aria-expanded", "false");
  }

  toggle() { this.menu.classList.contains("hidden") ? this.open() : this.close(); }
  visiblePapers() { return filterPapers(this.papers, this.search.value); }

  onSearchKeydown(event) {
    const visible = this.visiblePapers();
    if (event.key === "ArrowDown") this.activeIndex = Math.min(visible.length - 1, this.activeIndex + 1);
    else if (event.key === "ArrowUp") this.activeIndex = Math.max(0, this.activeIndex - 1);
    else if (event.key === "Enter" && visible[this.activeIndex]) this.choose(visible[this.activeIndex].paper_id);
    else if (event.key === "Escape") { this.close(); this.trigger.focus(); }
    else return;
    event.preventDefault();
    this.renderList();
  }

  async choose(paperId) {
    try {
      if (paperId !== this.selectedId) await this.onSelect(paperId);
    } catch (error) {
      this.onError(error);
      return;
    }
    this.setSelected(paperId);
    this.close();
    this.trigger.focus();
  }

  render() { this.renderTrigger(); this.renderList(); }

  renderTrigger() {
    const paper = this.papers.find((item) => item.paper_id === this.selectedId) || this.papers[0];
    this.trigger.replaceChildren();
    if (!paper) {
      this.trigger.textContent = "没有可审核论文";
      return;
    }
    this.trigger.dataset.state = paper.state.key;
    this.trigger.title = `${paper.title} — ${paper.paper_id}`;
    const sequence = document.createElement("span");
    sequence.className = "paper-sequence";
    sequence.textContent = paper.sequence;
    const dot = document.createElement("span");
    dot.className = "paper-state-dot";
    const title = document.createElement("span");
    title.className = "paper-trigger-title";
    title.textContent = paper.title;
    const pct = document.createElement("span");
    pct.className = "paper-trigger-pct";
    pct.textContent = `${paper.pct}%`;
    const arrow = document.createElement("span");
    arrow.className = "paper-trigger-arrow";
    arrow.textContent = "⌄";
    this.trigger.append(sequence, dot, title, pct, arrow);
  }

  renderList() {
    const visible = this.visiblePapers();
    this.list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "paper-empty";
      empty.textContent = "没有匹配的论文";
      this.list.appendChild(empty);
      return;
    }
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, visible.length - 1));
    visible.forEach((paper, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `paper-option-${paper.sequence}`;
      option.className = "paper-option";
      option.dataset.state = paper.state.key;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(paper.paper_id === this.selectedId));
      option.classList.toggle("active", index === this.activeIndex);
      option.classList.toggle("selected", paper.paper_id === this.selectedId);
      option.title = `${paper.title} — ${paper.paper_id}`;

      const sequence = document.createElement("span");
      sequence.className = "paper-sequence";
      sequence.textContent = paper.sequence;
      const dot = document.createElement("span");
      dot.className = "paper-state-dot";
      const copy = document.createElement("span");
      copy.className = "paper-option-copy";
      const title = document.createElement("span");
      title.className = "paper-option-title";
      title.textContent = paper.title;
      const meta = document.createElement("span");
      meta.className = "paper-option-meta";
      meta.textContent = `${paper.paper_id} · ${paper.done}/${paper.total} 字段已审`;
      copy.append(title, meta);
      const status = document.createElement("span");
      status.className = "paper-state-label";
      status.textContent = `${paper.pct}% ${paper.state.label}`;
      option.append(sequence, dot, copy, status);
      option.addEventListener("click", () => this.choose(paper.paper_id));
      this.list.appendChild(option);
    });
    this.search.setAttribute("aria-activedescendant", `paper-option-${visible[this.activeIndex].sequence}`);
  }
}
```

- [ ] **Step 4: Replace the native select markup**

In `app/static/index.html`, replace `#paper-select` with:

```html
<div id="paper-picker" class="paper-picker">
  <button id="paper-trigger" class="paper-trigger" type="button"
          aria-haspopup="listbox" aria-expanded="false"
          title="切换论文 (Windows: Ctrl+P / Mac: ⌘P)"></button>
  <div id="paper-menu" class="paper-menu hidden">
    <input id="paper-search" type="search" placeholder="搜索标题或 DOI…"
           aria-label="搜索论文" />
    <div id="paper-list" class="paper-list" role="listbox"></div>
  </div>
</div>
```

- [ ] **Step 5: Wire DOM references and application lifecycle**

In `dom.js`, replace `paperSelect` with `paperPicker`, `paperTrigger`, `paperMenu`, `paperSearch`, and `paperList` references.

In `app.js`:

- create one `PaperPicker` after `/api/papers` succeeds;
- pass an `onSelect` callback that awaits `store.flush()` and `loadPaper(paperId)`;
- pass an `onError` callback that writes the escaped load error into `#fields-list` and leaves the current picker selection unchanged;
- call `setPapers(papers)` and select the first paper;
- replace direct `<select>` population and `change` handling;
- call `paperPicker.setSelected(pid)` inside `loadPaper()`;
- call `paperPicker.updateProgress(store.paperId, {...store.progress(), task_status: store.doc.task_status})` from `renderProgress()`;
- make `Ctrl/Command + P` call `paperPicker.open()`.

- [ ] **Step 6: Add paper-picker styles**

Add CSS for a top-bar-width trigger, absolutely positioned menu, search field, scrollable option list, two-line metadata, selected/keyboard-active states, and these state variables:

```css
.paper-picker [data-state="complete"] { --paper-state: #1a9d63; }
.paper-picker [data-state="in-progress"] { --paper-state: #e0900a; }
.paper-picker [data-state="not-started"] { --paper-state: #9aa4b2; }
.paper-picker [data-state="inconsistent"] { --paper-state: #e03b3b; }
```

Use the variable only for the status dot and light badge treatment; do not recolor the full row.

- [ ] **Step 7: Run tests and verify GREEN**

Run: `npm run test:frontend`

Expected: 4 tests pass, 0 fail.

- [ ] **Step 8: Commit the picker**

```bash
git add app/static/index.html app/static/js/dom.js app/static/js/app.js app/static/js/paper-picker.js app/static/css/style.css tests/frontend/paper-picker.test.js
git commit -m "feat: add searchable paper picker"
```

## Task 4: Reliable Keyboard Field Following

**Files:**
- Create: `tests/frontend/navigation.test.js`
- Create: `app/static/js/navigation.js`
- Modify: `app/static/js/app.js`

- [ ] **Step 1: Write failing viewport tests**

Create `tests/frontend/navigation.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { rowNeedsScroll } from "../../app/static/js/navigation.js";

const viewport = { top: 100, bottom: 500 };

test("a fully visible field row does not scroll", () => {
  assert.equal(rowNeedsScroll({ top: 120, bottom: 160 }, viewport), false);
});

test("a row above the field viewport scrolls", () => {
  assert.equal(rowNeedsScroll({ top: 80, bottom: 120 }, viewport), true);
});

test("a row below the field viewport scrolls", () => {
  assert.equal(rowNeedsScroll({ top: 480, bottom: 520 }, viewport), true);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/frontend/navigation.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `navigation.js`.

- [ ] **Step 3: Implement the minimal navigation helper**

Create `app/static/js/navigation.js`:

```js
export function rowNeedsScroll(rowRect, viewportRect) {
  return rowRect.top < viewportRect.top || rowRect.bottom > viewportRect.bottom;
}

export function keepFieldRowVisible(fieldsList, fieldsScroll, fieldId) {
  const escaped = CSS.escape(fieldId);
  const row = fieldsList.querySelector(`.field-row[data-field-id="${escaped}"]`);
  if (!row) return false;
  if (!rowNeedsScroll(row.getBoundingClientRect(), fieldsScroll.getBoundingClientRect())) return false;
  row.scrollIntoView({ block: "nearest" });
  return true;
}
```

- [ ] **Step 4: Run the viewport tests and verify GREEN**

Run: `node --test tests/frontend/navigation.test.js`

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Fix `moveSelection()` using the newly rendered row**

Import `keepFieldRowVisible` in `app.js`, then replace the detached-row scroll with:

```js
function moveSelection(dir) {
  const rows = [...el.fieldsList.querySelectorAll(".field-row[data-field-id]")];
  if (!rows.length) return;
  let idx = rows.findIndex((row) => row.dataset.fieldId === ui.selectedFieldId);
  idx = Math.max(0, Math.min(rows.length - 1, idx + dir));
  const fieldId = rows[idx].dataset.fieldId;
  selectField(fieldId);
  keepFieldRowVisible(el.fieldsList, el.fieldsScroll, fieldId);
}
```

- [ ] **Step 6: Run the complete frontend suite**

Run: `npm run test:frontend`

Expected: 7 tests pass, 0 fail.

- [ ] **Step 7: Commit the navigation fix**

```bash
git add tests/frontend/navigation.test.js app/static/js/navigation.js app/static/js/app.js
git commit -m "fix: keep keyboard-selected fields visible"
```

## Task 5: Offline LaTeX Rendering and Source Toggle

**Files:**
- Create: `tests/frontend/latex.test.js`
- Create: `app/static/js/latex.js`
- Create: `app/static/vendor/katex/`
- Modify: `app/static/index.html`
- Modify: `app/static/js/dom.js`
- Modify: `app/static/js/source.js`
- Modify: `app/static/js/app.js`
- Modify: `app/static/css/style.css`

- [ ] **Step 1: Write failing LaTeX behavior and asset tests**

Create `tests/frontend/latex.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  LATEX_DELIMITERS,
  renderEvidenceMath,
} from "../../app/static/js/latex.js";

test("LaTeX rendering enables the four confirmed delimiters safely", () => {
  assert.deepEqual(LATEX_DELIMITERS.map((item) => [item.left, item.right, item.display]), [
    ["$$", "$$", true],
    ["\\[", "\\]", true],
    ["\\(", "\\)", false],
    ["$", "$", false],
  ]);
});

test("missing KaTeX renderer leaves evidence source unchanged", () => {
  const root = { classList: { add() {}, remove() {} } };
  assert.deepEqual(renderEvidenceMath(root, null), { available: false, errors: 0 });
});

test("renderer errors are reported without throwing away source", () => {
  const classes = new Set();
  const root = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  const result = renderEvidenceMath(root, (_root, options) => options.errorCallback("bad formula"));
  assert.deepEqual(result, { available: true, errors: 1 });
  assert.equal(classes.has("latex-has-errors"), true);
});

test("vendored KaTeX runtime and fonts exist", () => {
  assert.equal(existsSync("app/static/vendor/katex/katex.min.css"), true);
  assert.equal(existsSync("app/static/vendor/katex/katex.min.js"), true);
  assert.equal(existsSync("app/static/vendor/katex/contrib/auto-render.min.js"), true);
  assert.equal(existsSync("app/static/vendor/katex/fonts/KaTeX_Main-Regular.woff2"), true);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/frontend/latex.test.js`

Expected: FAIL because `latex.js` and vendored assets do not exist.

- [ ] **Step 3: Implement the safe rendering wrapper**

Create `app/static/js/latex.js`:

```js
export const LATEX_DELIMITERS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
];

export function renderEvidenceMath(root, renderer = globalThis.renderMathInElement) {
  root.classList.remove("latex-has-errors");
  if (typeof renderer !== "function") return { available: false, errors: 0 };
  let errors = 0;
  renderer(root, {
    delimiters: LATEX_DELIMITERS,
    throwOnError: false,
    strict: "ignore",
    trust: false,
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    errorCallback: (message) => {
      errors += 1;
      console.warn("KaTeX render error:", message);
    },
  });
  root.classList.toggle("latex-has-errors", errors > 0);
  return { available: true, errors };
}
```

- [ ] **Step 4: Vendor KaTeX 0.16.22**

Run these commands separately:

```bash
npm pack katex@0.16.22
tar -xzf katex-0.16.22.tgz
mkdir -p app/static/vendor/katex
cp -R package/dist/. app/static/vendor/katex/
rm -rf package katex-0.16.22.tgz
```

Expected: `app/static/vendor/katex/` contains CSS, JavaScript, `contrib/auto-render.min.js`, and fonts.

- [ ] **Step 5: Run the LaTeX tests and verify GREEN**

Run: `node --test tests/frontend/latex.test.js`

Expected: 4 tests pass, 0 fail.

- [ ] **Step 6: Load local KaTeX and add the pane toggle**

In `index.html`:

- add `<link rel="stylesheet" href="/vendor/katex/katex.min.css" />` after the main stylesheet;
- add deferred `/vendor/katex/katex.min.js` and `/vendor/katex/contrib/auto-render.min.js` scripts before `/js/app.js`;
- add `<button id="latex-toggle" class="btn ghost latex-toggle" type="button">查看源码</button>` beside `#evidence-status`.

- [ ] **Step 7: Connect rendering and source mode**

In `dom.js`, expose `latexToggle` and add `latexMode: "rendered"` to `ui`.

In `source.js`:

- import `renderEvidenceMath`;
- after `el.sourceBlocks.replaceChildren(frag)`, call `renderEvidenceMath(el.sourceBlocks)` when `ui.latexMode === "rendered"`; if it returns `available: false`, switch to source mode, disable the toggle, and set its title to `KaTeX 未加载，当前显示源码`;
- export `setLatexMode(mode)` that updates `ui.latexMode`, rebuilds source blocks from original server data, restores current evidence highlighting without forced scrolling, and updates button text to `查看源码` or `渲染公式`.

In `app.js`, wire `el.latexToggle` to toggle between `rendered` and `source`. Do not reset `ui.latexMode` inside `loadPaper()`.

- [ ] **Step 8: Style formulas and failures**

Add CSS so display math can scroll horizontally inside narrow evidence panes, inline math follows surrounding line height, and `.latex-has-errors` shows a small warning indicator without recoloring the entire source pane.

- [ ] **Step 9: Run all frontend tests**

Run: `npm run test:frontend`

Expected: 11 tests pass, 0 fail.

- [ ] **Step 10: Commit LaTeX support**

```bash
git add tests/frontend/latex.test.js app/static/js/latex.js app/static/vendor/katex app/static/index.html app/static/js/dom.js app/static/js/source.js app/static/js/app.js app/static/css/style.css
git commit -m "feat: render LaTeX evidence offline"
```

## Task 6: Documentation and Full Verification

**Files:**
- Modify: `docs/user_manual.md`
- Modify: `app/static/js/app.js`

- [ ] **Step 1: Update user-facing help**

Document in `docs/user_manual.md` and the in-app `buildHelp()` content:

- formulas render by default and can be switched to source;
- malformed formulas remain readable as source;
- `J/K` keeps the selected field visible;
- the paper picker supports title/DOI search, arrow keys, Enter, Escape, and `Ctrl/Command + P`;
- paper-level green/amber/gray/red meanings.

- [ ] **Step 2: Run frontend tests**

Run: `npm run test:frontend`

Expected: 11 tests pass, 0 fail.

- [ ] **Step 3: Run backend tests**

Run: `pytest -q`

Expected: all existing Python tests pass with 0 failures.

- [ ] **Step 4: Run static checks**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `node --check app/static/js/app.js`

Expected: exit code 0.

Run: `node --check app/static/js/paper-picker.js`

Expected: exit code 0.

Run: `node --check app/static/js/navigation.js`

Expected: exit code 0.

Run: `node --check app/static/js/latex.js`

Expected: exit code 0.

- [ ] **Step 5: Perform browser acceptance**

Start the application with `./run.sh`, sign in with an assigned test account, and verify every item in the design's Browser Acceptance section. Specifically record that repeated `J` presses move the middle pane, formula source/render switching works, and the paper picker search/keyboard states are visible and usable.

- [ ] **Step 6: Commit documentation**

```bash
git add docs/user_manual.md app/static/js/app.js
git commit -m "docs: explain frontend review enhancements"
```

- [ ] **Step 7: Inspect final scope**

Run: `git status --short`

Expected: only the user's pre-existing unrelated files remain modified or untracked.

Run: `git log --oneline -7`

Expected: the plan's focused commits appear above the pre-existing history.
