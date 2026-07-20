import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import katex from "../../app/static/vendor/katex/katex.mjs";

import {
  extractFailedExpression,
  failedFormulaCandidates,
  getLatexToggleState,
  hasEvidenceBlocks,
  LATEX_DELIMITERS,
  LATEX_IGNORED_TAGS,
  markFailedFormulas,
  renderEvidenceMath,
} from "../../app/static/js/latex.js";

class FakeNode {
  constructor(nodeType, ownerDocument) {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  insertBefore(node, reference) {
    const index = this.childNodes.indexOf(reference);
    node.parentNode = this;
    this.childNodes.splice(index, 0, node);
  }

  removeChild(node) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
  }
}

class FakeText extends FakeNode {
  constructor(text, ownerDocument) {
    super(3, ownerDocument);
    this.textContent = text;
  }
}

class FakeElement extends FakeNode {
  constructor(tagName, ownerDocument) {
    super(1, ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [];
    if (value !== "") this.append(this.ownerDocument.createTextNode(String(value)));
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName, this); }
  createTextNode(text) { return new FakeText(text, this); }
}

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

test("failedFormulaCandidates returns all supported delimiters longest first", () => {
  assert.deepEqual(failedFormulaCandidates("\\frac{"), [
    "$$\\frac{$$",
    "\\[\\frac{\\]",
    "\\(\\frac{\\)",
    "$\\frac{$",
  ]);
});

test("extractFailedExpression reads KaTeX auto-render errors", () => {
  assert.equal(
    extractFailedExpression("KaTeX auto-render: Failed to parse `\\frac{` with ParseError: Expected '}'"),
    "\\frac{",
  );
  assert.equal(extractFailedExpression("bad formula"), null);
});

test("markFailedFormulas marks multiple source formulas without touching KaTeX output", () => {
  const document = new FakeDocument();
  const root = document.createElement("div");
  const prose = document.createElement("p");
  prose.append(document.createTextNode("Before $$\\frac{$$ middle $x$ after \\(\\sqrt{\\)."));
  const rendered = document.createElement("span");
  rendered.className = "katex";
  rendered.append(document.createTextNode("$x$"));
  root.append(prose, rendered);

  assert.equal(markFailedFormulas(root, ["\\frac{", "x", "\\sqrt{"]), 3);

  const markers = prose.childNodes.filter((node) => node.className === "latex-formula-error");
  assert.deepEqual(markers.map((node) => node.textContent), ["$$\\frac{$$", "$x$", "\\(\\sqrt{\\)"]);
  for (const marker of markers) {
    assert.equal(marker.attributes.get("role"), "note");
    assert.equal(marker.attributes.get("title"), "公式解析失败，已保留 LaTeX 源码");
    assert.match(marker.attributes.get("aria-label"), /^公式解析失败，已保留 LaTeX 源码：/);
    assert.match(marker.attributes.get("aria-label"), new RegExp(marker.textContent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(rendered.textContent, "$x$");
});

test("markFailedFormulas marks only as many occurrences as auto-render reported", () => {
  const document = new FakeDocument();
  const root = document.createElement("div");
  root.append(document.createTextNode("$$x$$ and $x$"));

  assert.equal(markFailedFormulas(root, ["x"]), 1);
  assert.equal(root.childNodes.filter((node) => node.className === "latex-formula-error").length, 1);
  assert.equal(root.textContent, "$$x$$ and $x$");
});

test("markFailedFormulas skips auto-render ignored tags before the real failure", () => {
  const document = new FakeDocument();
  const root = document.createElement("div");
  const code = document.createElement("code");
  code.append(document.createTextNode("Example $\\frac{$ source"));
  const prose = document.createElement("p");
  prose.append(document.createTextNode("Failed $\\frac{$ source"));
  root.append(code, prose);

  assert.equal(markFailedFormulas(root, ["\\frac{"]), 1);
  assert.equal(code.childNodes.some((node) => node.className === "latex-formula-error"), false);
  assert.equal(prose.childNodes.some((node) => node.className === "latex-formula-error"), true);
});

test("renderEvidenceMath marks the exact failed formula from auto-render callback", () => {
  const document = new FakeDocument();
  const root = document.createElement("div");
  root.classList = fakeRoot().classList;
  root.append(document.createTextNode("Valid text and $\\frac{$ source"));
  const originalWarn = console.warn;
  const renderer = (_root, options) => {
    options.errorCallback("KaTeX auto-render: Failed to parse `\\frac{` with", new Error("bad"));
  };

  console.warn = () => {};
  try {
    assert.deepEqual(renderEvidenceMath(root, renderer), { available: true, errors: 1 });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(root.childNodes[1].className, "latex-formula-error");
  assert.equal(root.childNodes[1].textContent, "$\\frac{$");
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
  assert.equal(options.ignoredTags, LATEX_IGNORED_TAGS);
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

test("KaTeX runtime, notices, auto-render helper, stylesheet, and a core font are vendored", () => {
  const files = [
    "app/static/vendor/katex/LICENSE",
    "app/static/vendor/katex/VENDOR.md",
    "app/static/vendor/katex/katex.min.css",
    "app/static/vendor/katex/katex.min.js",
    "app/static/vendor/katex/contrib/auto-render.min.js",
    "app/static/vendor/katex/fonts/KaTeX_Main-Regular.woff2",
  ];

  for (const file of files) assert.equal(fs.existsSync(file), true, `${file} should exist`);

  const notice = fs.readFileSync("app/static/vendor/katex/VENDOR.md", "utf8");
  assert.match(notice, /0\.16\.22/);
  assert.match(notice, /MIT/i);
  assert.match(notice, /LICENSE/);
});
