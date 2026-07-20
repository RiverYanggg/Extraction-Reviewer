import test from "node:test";
import assert from "node:assert/strict";

import {
  derivePaperState,
  filterPapers,
  formatPaperSequence,
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
    { title: "Evidence Synthesis", paper_id: "10.1000/Alpha" },
    { title: "Clinical Review", paper_id: "10.2000/BETA" },
  ];

  assert.deepEqual(filterPapers(papers, "eVIdence"), [papers[0]]);
  assert.deepEqual(filterPapers(papers, "beta"), [papers[1]]);
  assert.deepEqual(filterPapers(papers, "missing"), []);
  assert.equal(filterPapers(papers), papers);
});
