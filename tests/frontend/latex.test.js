import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import katex from "../../app/static/vendor/katex/katex.mjs";

import {
  getLatexToggleState,
  hasEvidenceBlocks,
  LATEX_DELIMITERS,
  renderEvidenceMath,
} from "../../app/static/js/latex.js";

function fakeRoot(text = "Original $x$ source") {
  const classes = new Set();
  return {
    textContent: text,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
  };
}

test("LATEX_DELIMITERS uses the required safe matching order", () => {
  assert.deepEqual(
    LATEX_DELIMITERS.map(({ left, right, display }) => [left, right, display]),
    [
      ["$$", "$$", true],
      ["\\[", "\\]", true],
      ["\\(", "\\)", false],
      ["$", "$", false],
    ],
  );
});

test("renderEvidenceMath leaves source untouched when renderer is unavailable", () => {
  const root = fakeRoot();
  const original = root.textContent;

  assert.deepEqual(renderEvidenceMath(root, null), { available: false, errors: 0 });
  assert.equal(root.textContent, original);
  assert.equal(root.classList.contains("latex-has-errors"), false);
});

test("renderEvidenceMath records formula errors and marks the evidence root", () => {
  const root = fakeRoot();
  let options;
  const warnings = [];
  const originalWarn = console.warn;
  const renderer = (_root, receivedOptions) => {
    options = receivedOptions;
    receivedOptions.errorCallback("bad formula");
  };

  console.warn = (...args) => warnings.push(args);
  try {
    assert.deepEqual(renderEvidenceMath(root, renderer), { available: true, errors: 1 });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(root.classList.contains("latex-has-errors"), true);
  assert.equal(warnings.length, 1);
  assert.equal(options.throwOnError, true);
  assert.equal(options.strict, "ignore");
  assert.equal(options.trust, false);
});

test("renderEvidenceMath restores readable source after a renderer exception", () => {
  const root = fakeRoot();
  root.innerHTML = "Original $x$ source";
  const originalWarn = console.warn;
  const renderer = (node) => {
    node.innerHTML = "";
    throw new Error("renderer crashed");
  };

  console.warn = () => {};
  try {
    assert.deepEqual(renderEvidenceMath(root, renderer), {
      available: true,
      errors: 1,
      fatal: true,
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(root.innerHTML, "Original $x$ source");
  assert.equal(root.classList.contains("latex-has-errors"), true);
});

test("source mode keeps the toggle disabled after KaTeX was unavailable", () => {
  assert.deepEqual(getLatexToggleState("source", false), {
    disabled: true,
    pressed: false,
    label: "LaTeX 源码模式（KaTeX 未加载）",
    text: "源码模式",
    title: "KaTeX 未加载，当前显示源码",
  });
  assert.deepEqual(getLatexToggleState("source", null), {
    disabled: true,
    pressed: false,
    label: "LaTeX 源码模式（KaTeX 未加载）",
    text: "源码模式",
    title: "KaTeX 未加载，当前显示源码",
  });
});

test("real KaTeX throws malformed formulas only when throwOnError is true", () => {
  assert.throws(
    () => katex.renderToString("\\frac{", { throwOnError: true }),
    katex.ParseError,
  );
  assert.match(
    katex.renderToString("\\frac{", { throwOnError: false }),
    /class="katex-error"/,
  );
});

test("evidence block guard rejects missing or malformed paper data", () => {
  assert.equal(hasEvidenceBlocks(null), false);
  assert.equal(hasEvidenceBlocks({}), false);
  assert.equal(hasEvidenceBlocks({ blocks: null }), false);
  assert.equal(hasEvidenceBlocks({ blocks: [] }), true);
});

test("LaTeX toggle starts disabled until evidence and renderer availability are known", () => {
  const html = fs.readFileSync("app/static/index.html", "utf8");
  assert.match(html, /<button id="latex-toggle"[^>]*\bdisabled\b[^>]*>/);
});

test("available toggle state exposes pressed and accessible action labels", () => {
  assert.deepEqual(getLatexToggleState("rendered", true), {
    disabled: false,
    pressed: true,
    label: "查看 LaTeX 源码",
    text: "查看源码",
    title: "查看 LaTeX 源码",
  });
  assert.deepEqual(getLatexToggleState("source", true), {
    disabled: false,
    pressed: false,
    label: "渲染 LaTeX 公式",
    text: "渲染公式",
    title: "渲染 LaTeX 公式",
  });
});

test("KaTeX runtime, auto-render helper, stylesheet, and a core font are vendored", () => {
  const files = [
    "app/static/vendor/katex/katex.min.css",
    "app/static/vendor/katex/katex.min.js",
    "app/static/vendor/katex/contrib/auto-render.min.js",
    "app/static/vendor/katex/fonts/KaTeX_Main-Regular.woff2",
  ];

  for (const file of files) assert.equal(fs.existsSync(file), true, `${file} should exist`);
});
