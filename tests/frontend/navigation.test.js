import test from "node:test";
import assert from "node:assert/strict";

import {
  isFieldRowNavigable,
  keepFieldRowVisible,
  rowNeedsScroll,
} from "../../app/static/js/navigation.js";

const viewport = { top: 100, bottom: 500 };

test("rowNeedsScroll leaves a fully visible row in place", () => {
  assert.equal(rowNeedsScroll({ top: 120, bottom: 160 }, viewport), false);
});

test("rowNeedsScroll detects a row above the viewport", () => {
  assert.equal(rowNeedsScroll({ top: 80, bottom: 120 }, viewport), true);
});

test("rowNeedsScroll detects a row below the viewport", () => {
  assert.equal(rowNeedsScroll({ top: 480, bottom: 520 }, viewport), true);
});

test("isFieldRowNavigable skips rows inside collapsed tree children", () => {
  const collapsedRow = {
    closest(selector) {
      assert.equal(selector, ".tchildren.collapsed");
      return { className: "tchildren collapsed" };
    },
  };
  const visibleRow = {
    closest(selector) {
      assert.equal(selector, ".tchildren.collapsed");
      return null;
    },
  };

  assert.equal(isFieldRowNavigable(collapsedRow), false);
  assert.equal(isFieldRowNavigable(visibleRow), true);
});

test("keepFieldRowVisible leaves a visible newly rendered row in place", () => {
  let scrollCalls = 0;
  const postRenderRow = {
    dataset: { fieldId: "field-a" },
    getBoundingClientRect: () => ({ top: 120, bottom: 160 }),
    scrollIntoView: () => { scrollCalls += 1; },
  };
  const fieldsList = {
    querySelectorAll(selector) {
      assert.equal(selector, ".field-row[data-field-id]");
      return [postRenderRow];
    },
  };
  const fieldsScroll = { getBoundingClientRect: () => viewport };

  assert.equal(keepFieldRowVisible(fieldsList, fieldsScroll, "field-a"), false);
  assert.equal(scrollCalls, 0);
});

test("keepFieldRowVisible scrolls the clipped newly rendered row nearest", () => {
  let scrollOptions = null;
  const postRenderRow = {
    dataset: { fieldId: "field-b" },
    getBoundingClientRect: () => ({ top: 480, bottom: 520 }),
    scrollIntoView: (options) => { scrollOptions = options; },
  };
  const fieldsList = {
    querySelectorAll: () => [postRenderRow],
  };
  const fieldsScroll = { getBoundingClientRect: () => viewport };

  assert.equal(keepFieldRowVisible(fieldsList, fieldsScroll, "field-b"), true);
  assert.deepEqual(scrollOptions, { block: "nearest" });
});

test("keepFieldRowVisible returns false when the newly rendered row is missing", () => {
  const fieldsList = { querySelectorAll: () => [] };
  const fieldsScroll = {
    getBoundingClientRect() {
      throw new Error("viewport should not be measured without a matching row");
    },
  };

  assert.equal(keepFieldRowVisible(fieldsList, fieldsScroll, "missing"), false);
});
