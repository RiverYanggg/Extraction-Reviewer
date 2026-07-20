import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  derivePaperState,
  filterPapers,
  formatPaperSequence,
  normalizePaperSummary,
  PaperPicker,
} from "../../app/static/js/paper-picker.js";

test("derivePaperState maps progress to the paper summary state", () => {
  assert.deepEqual(
    derivePaperState({ pct: 0, task_status: "not_started" }),
    { key: "not-started", label: "未开始" },
  );
  assert.deepEqual(
    derivePaperState({ pct: 37, task_status: "in_progress" }),
    { key: "in-progress", label: "进行中" },
  );
  assert.deepEqual(
    derivePaperState({ pct: 100, task_status: "submitted" }),
    { key: "complete", label: "已完成" },
  );
  assert.deepEqual(
    derivePaperState({ pct: 80, task_status: "submitted" }),
    { key: "inconsistent", label: "提交异常" },
  );
});

test("formatPaperSequence formats a one-based paper sequence", () => {
  assert.equal(formatPaperSequence(0), "01");
  assert.equal(formatPaperSequence(8), "09");
  assert.equal(formatPaperSequence(99), "100");
});

test("filterPapers matches title and DOI case-insensitively", () => {
  const papers = [
    {
      title: "Evidence Synthesis",
      paper_id: "10.1016_j.matlet.2024.136522",
      doi: "10.1016/j.matlet.2024.136522",
    },
    { title: "Clinical Review", paper_id: "10.2000_BETA", doi: "10.2000/BETA" },
  ];

  assert.deepEqual(filterPapers(papers, "eVIdence"), [papers[0]]);
  assert.deepEqual(filterPapers(papers, "10.1016/j.matlet.2024.136522"), [papers[0]]);
  assert.deepEqual(filterPapers(papers, "10.1016_j.matlet"), [papers[0]]);
  assert.deepEqual(filterPapers(papers, "beta"), [papers[1]]);
  assert.deepEqual(filterPapers(papers, "missing"), []);
  assert.equal(filterPapers(papers), papers);
});

test("normalizePaperSummary creates a display-ready summary", () => {
  assert.deepEqual(
    normalizePaperSummary({
      paper_id: "10.test/example",
      doi: "10.test/example-doi",
      title: "Example",
      progress: {
        done: 3,
        total: 8,
        pct: 38,
        task_status: "in_progress",
      },
    }, 1),
    {
      paper_id: "10.test/example",
      doi: "10.test/example-doi",
      title: "Example",
      sequence: "02",
      done: 3,
      total: 8,
      pct: 38,
      state: { key: "in-progress", label: "进行中" },
    },
  );
});

test("normalizePaperSummary falls back to the DOI when title is missing", () => {
  const summary = normalizePaperSummary({ paper_id: "10.test/untitled", progress: {} }, 0);
  assert.equal(summary.title, "10.test/untitled");
  assert.equal(summary.doi, "10.test/untitled");
});

function pickerForChoose(onSelect, onError = () => {}) {
  const picker = Object.create(PaperPicker.prototype);
  Object.assign(picker, {
    selectedId: "paper-a",
    loadedPaperId: null,
    retryRequired: false,
    loading: false,
    onSelect,
    onError,
    trigger: { focus() {} },
    search: { focus() {} },
    setSelected(paperId) { this.selectedId = paperId; },
    close() {},
    renderList() {},
    renderTrigger() {},
    setLoading(value) { this.loading = value; },
  });
  return picker;
}

test("PaperPicker prevents concurrent selections and clears loading after success", async () => {
  let resolveSelection;
  let calls = 0;
  const selection = new Promise((resolve) => { resolveSelection = resolve; });
  const picker = pickerForChoose(() => {
    calls += 1;
    return selection;
  });

  const first = picker.choose("paper-b");
  const second = picker.choose("paper-c");

  assert.equal(calls, 1);
  assert.equal(picker.loading, true);
  resolveSelection();
  await Promise.all([first, second]);
  assert.equal(picker.loading, false);
  assert.equal(picker.selectedId, "paper-b");
});

test("PaperPicker clears loading after a failed selection", async () => {
  let rejectSelection;
  const selection = new Promise((resolve, reject) => { rejectSelection = reject; });
  const picker = pickerForChoose(
    () => selection,
    () => {},
  );

  const choosing = picker.choose("paper-b");
  assert.equal(picker.loading, true);
  rejectSelection(new Error("load failed"));
  await choosing;

  assert.equal(picker.loading, false);
  assert.equal(picker.selectedId, "paper-a");
});

test("PaperPicker loads a preselected paper that has not loaded yet", async () => {
  let calls = 0;
  const picker = pickerForChoose(async () => { calls += 1; });

  await picker.choose("paper-a");

  assert.equal(calls, 1);
  assert.equal(picker.loadedPaperId, "paper-a");
});

test("PaperPicker retries the same paper after a failed load", async () => {
  let calls = 0;
  const picker = pickerForChoose(async () => {
    calls += 1;
    if (calls === 1) throw new Error("load failed");
  });

  await picker.choose("paper-a");
  await picker.choose("paper-a");

  assert.equal(calls, 2);
  assert.equal(picker.loadedPaperId, "paper-a");
  assert.equal(picker.retryRequired, false);
});

test("PaperPicker short-circuits only after the paper loaded successfully", async () => {
  let calls = 0;
  const picker = pickerForChoose(async () => { calls += 1; });

  await picker.choose("paper-b");
  await picker.choose("paper-b");

  assert.equal(calls, 1);
  assert.equal(picker.loadedPaperId, "paper-b");
});

test("PaperPicker leaves trigger Enter to the native button click", () => {
  const picker = Object.create(PaperPicker.prototype);
  let handled = false;
  picker.handleKeydown = () => { handled = true; };

  picker.handleTriggerKeydown({ key: "Enter" });

  assert.equal(handled, false);
});

test("PaperPicker does not rerender unchanged progress", () => {
  const picker = Object.create(PaperPicker.prototype);
  picker.papers = [{
    paper_id: "paper-a",
    done: 3,
    total: 8,
    pct: 38,
    state: { key: "in-progress", label: "进行中" },
  }];
  let renders = 0;
  picker.renderTrigger = () => { renders += 1; };
  picker.renderList = () => { renders += 1; };

  picker.updateProgress("paper-a", {
    done: 3,
    total: 8,
    pct: 38,
    task_status: "in_progress",
  });

  assert.equal(renders, 0);
});

test("paper search exposes the combobox/listbox ARIA contract", () => {
  const html = readFileSync(new URL("../../app/static/index.html", import.meta.url), "utf8");
  assert.match(html, /id="paper-trigger"[^>]*aria-haspopup="listbox"[^>]*aria-controls="paper-menu"/);
  assert.match(html, /id="paper-search"[^>]*role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-controls="paper-list"[^>]*aria-expanded="false"/);
  assert.match(html, /id="paper-list"[^>]*role="listbox"/);
});
