export const LATEX_DELIMITERS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
];

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
  const originalMarkup = typeof root.innerHTML === "string" ? root.innerHTML : null;
  try {
    renderer(root, {
      delimiters: LATEX_DELIMITERS,
      throwOnError: true,
      strict: "ignore",
      trust: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      errorCallback(message) {
        errors += 1;
        console.warn("KaTeX formula render warning:", message);
      },
    });
  } catch (error) {
    errors += 1;
    if (originalMarkup !== null) root.innerHTML = originalMarkup;
    console.warn("KaTeX evidence render failed; keeping source readable:", error);
    root.classList.add("latex-has-errors");
    return { available: true, errors, fatal: true };
  }

  root.classList.toggle("latex-has-errors", errors > 0);
  return { available: true, errors };
}
