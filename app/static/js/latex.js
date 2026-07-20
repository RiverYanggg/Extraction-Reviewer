export const LATEX_DELIMITERS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
];

export const LATEX_IGNORED_TAGS = Object.freeze([
  "script",
  "noscript",
  "style",
  "textarea",
  "pre",
  "code",
]);

const FORMULA_ERROR_TITLE = "公式解析失败，已保留 LaTeX 源码";

export function failedFormulaCandidates(expression) {
  return LATEX_DELIMITERS.map(({ left, right }) => `${left}${expression}${right}`);
}

export function extractFailedExpression(message) {
  const text = String(message || "");
  const prefix = "Failed to parse `";
  const start = text.indexOf(prefix);
  const end = text.lastIndexOf("` with");
  if (start < 0 || end < start + prefix.length) return null;
  return text.slice(start + prefix.length, end);
}

function hasSkippedAncestor(node, root) {
  for (let current = node.parentNode; current && current !== root; current = current.parentNode) {
    const classes = String(current.className || "").split(/\s+/);
    if (classes.includes("katex") || classes.includes("latex-formula-error")) return true;
  }
  return false;
}

function isSkippedElement(node) {
  const classes = String(node.className || "").split(/\s+/);
  const tagName = String(node.tagName || "").toLowerCase();
  return classes.includes("katex")
    || classes.includes("latex-formula-error")
    || LATEX_IGNORED_TAGS.includes(tagName);
}

function eligibleTextNodes(root) {
  const nodes = [];
  const visit = (node) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType === 3) {
        if (!hasSkippedAncestor(child, root)) nodes.push(child);
      } else if (child.nodeType === 1) {
        if (!isSkippedElement(child)) visit(child);
      }
    }
  };
  visit(root);
  return nodes;
}

function nextCandidate(text, offset, candidates) {
  let match = null;
  for (const candidate of candidates) {
    if (candidate.group.remaining < 1) continue;
    const index = text.indexOf(candidate.source, offset);
    if (index < 0) continue;
    if (!match || index < match.index || (index === match.index && candidate.source.length > match.candidate.source.length)) {
      match = { candidate, index };
    }
  }
  return match;
}

export function markFailedFormulas(root, expressions) {
  const counts = new Map();
  for (const expression of expressions) {
    if (typeof expression !== "string") continue;
    counts.set(expression, (counts.get(expression) || 0) + 1);
  }
  const candidates = [];
  for (const [expression, remaining] of counts) {
    const group = { remaining };
    for (const source of failedFormulaCandidates(expression)) {
      candidates.push({ source, group });
    }
  }

  let marked = 0;
  for (const node of eligibleTextNodes(root)) {
    const text = node.textContent || "";
    const pieces = [];
    let offset = 0;
    while (offset < text.length) {
      const match = nextCandidate(text, offset, candidates);
      if (!match) break;
      if (match.index > offset) pieces.push({ text: text.slice(offset, match.index) });
      pieces.push({ text: match.candidate.source, error: true });
      match.candidate.group.remaining -= 1;
      marked += 1;
      offset = match.index + match.candidate.source.length;
    }
    if (!pieces.length) continue;
    if (offset < text.length) pieces.push({ text: text.slice(offset) });

    const parent = node.parentNode;
    const document = node.ownerDocument || root.ownerDocument;
    for (const piece of pieces) {
      if (!piece.error) {
        parent.insertBefore(document.createTextNode(piece.text), node);
        continue;
      }
      const marker = document.createElement("span");
      marker.className = "latex-formula-error";
      marker.setAttribute("role", "note");
      marker.setAttribute("title", FORMULA_ERROR_TITLE);
      marker.setAttribute("aria-label", `${FORMULA_ERROR_TITLE}：${piece.text}`);
      marker.textContent = piece.text;
      parent.insertBefore(marker, node);
    }
    parent.removeChild(node);
  }
  return marked;
}

export function hasEvidenceBlocks(data) {
  return Array.isArray(data?.blocks);
}

export function getLatexToggleState(mode, available, errors = 0) {
  if (available !== true) {
    return {
      disabled: true,
      pressed: false,
      label: "LaTeX 源码模式（KaTeX 未加载）",
      text: "源码模式",
      title: "KaTeX 未加载，当前显示源码",
    };
  }
  if (mode === "rendered") {
    return {
      disabled: false,
      pressed: true,
      label: "查看 LaTeX 源码",
      text: "查看源码",
      title: errors ? "部分公式渲染失败；点击查看源码" : "查看 LaTeX 源码",
    };
  }
  return {
    disabled: false,
    pressed: false,
    label: "渲染 LaTeX 公式",
    text: "渲染公式",
    title: "渲染 LaTeX 公式",
  };
}

export function renderEvidenceMath(root, renderer = globalThis.renderMathInElement) {
  root.classList.remove("latex-has-errors");
  if (typeof renderer !== "function") return { available: false, errors: 0 };

  let errors = 0;
  const failedExpressions = [];
  const originalMarkup = typeof root.innerHTML === "string" ? root.innerHTML : null;
  try {
    renderer(root, {
      delimiters: LATEX_DELIMITERS,
      throwOnError: true,
      strict: "ignore",
      trust: false,
      ignoredTags: LATEX_IGNORED_TAGS,
      errorCallback(message, error) {
        errors += 1;
        const expression = extractFailedExpression(message);
        if (expression !== null) failedExpressions.push(expression);
        console.warn("KaTeX formula render warning:", message, error);
      },
    });
  } catch (error) {
    errors += 1;
    if (originalMarkup !== null) root.innerHTML = originalMarkup;
    console.warn("KaTeX evidence render failed; keeping source readable:", error);
    root.classList.add("latex-has-errors");
    return { available: true, errors, fatal: true };
  }

  markFailedFormulas(root, failedExpressions);
  root.classList.toggle("latex-has-errors", errors > 0);
  return { available: true, errors };
}
