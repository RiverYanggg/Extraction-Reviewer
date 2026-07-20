export function derivePaperState(progress = {}) {
  const pct = Number(progress.pct) || 0;

  if (progress.task_status === "submitted" && pct < 100) {
    return { key: "inconsistent", label: "提交异常" };
  }
  if (pct >= 100) {
    return { key: "complete", label: "已完成" };
  }
  if (pct > 0) {
    return { key: "in-progress", label: "进行中" };
  }
  return { key: "not-started", label: "未开始" };
}

export function formatPaperSequence(index) {
  return String(index + 1).padStart(2, "0");
}

export function filterPapers(papers, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return papers;

  return papers.filter((paper) => {
    const searchable = `${paper.title || ""} ${paper.paper_id || ""}`.toLowerCase();
    return searchable.includes(needle);
  });
}

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

function appendTextElement(parent, tag, className, text) {
  const node = parent.ownerDocument.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
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
    this.loadedPaperId = null;
    this.retryRequired = false;
    this.activeIndex = -1;
    this.loading = false;

    this.trigger.addEventListener("click", () => this.toggle());
    this.trigger.addEventListener("keydown", (event) => this.handleTriggerKeydown(event));
    this.search.addEventListener("input", () => {
      this.activeIndex = this.visiblePapers().length ? 0 : -1;
      this.renderList();
    });
    this.search.addEventListener("keydown", (event) => this.handleKeydown(event));
    this.root.ownerDocument.addEventListener("click", (event) => {
      if (!this.root.contains(event.target)) this.close();
    });
  }

  setPapers(papers) {
    this.papers = (papers || []).map(normalizePaperSummary);
    if (!this.papers.some((paper) => paper.paper_id === this.selectedId)) {
      this.selectedId = this.papers[0]?.paper_id || null;
    }
    if (!this.papers.some((paper) => paper.paper_id === this.loadedPaperId)) {
      this.loadedPaperId = null;
    }
    if (!this.papers.length) this.retryRequired = false;
    this.renderTrigger();
    this.renderList();
  }

  setSelected(paperId) {
    this.selectedId = paperId || null;
    this.renderTrigger();
    this.renderList();
  }

  markLoaded(paperId) {
    this.loadedPaperId = paperId;
    this.retryRequired = false;
    this.setSelected(paperId);
  }

  markLoadFailed() {
    this.retryRequired = true;
  }

  updateProgress(paperId, progress = {}) {
    const paper = this.papers.find((item) => item.paper_id === paperId);
    if (!paper) return;
    const next = {
      done: Number(progress.done) || 0,
      total: Number(progress.total) || 0,
      pct: Number(progress.pct) || 0,
      state: derivePaperState(progress),
    };
    if (
      paper.done === next.done
      && paper.total === next.total
      && paper.pct === next.pct
      && paper.state.key === next.state.key
      && paper.state.label === next.state.label
    ) return;
    Object.assign(paper, next);
    this.renderTrigger();
    this.renderList();
  }

  open() {
    this.menu.classList.remove("hidden");
    this.trigger.setAttribute("aria-expanded", "true");
    this.search.setAttribute("aria-expanded", "true");
    this.search.value = "";
    const selectedIndex = this.papers.findIndex((paper) => paper.paper_id === this.selectedId);
    this.activeIndex = selectedIndex >= 0 ? selectedIndex : (this.papers.length ? 0 : -1);
    this.renderList();
    this.search.focus();
  }

  close() {
    this.menu.classList.add("hidden");
    this.trigger.setAttribute("aria-expanded", "false");
    this.search.setAttribute("aria-expanded", "false");
    this.search.removeAttribute("aria-activedescendant");
  }

  toggle() {
    if (this.menu.classList.contains("hidden")) this.open();
    else this.close();
  }

  visiblePapers() {
    return filterPapers(this.papers, this.search.value);
  }

  handleTriggerKeydown(event) {
    if (event.key === "Enter" || event.key === " ") return;
    this.handleKeydown(event);
  }

  handleKeydown(event) {
    const handled = ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key);
    if (!handled) return;

    event.preventDefault();
    if (event.key === "Escape") {
      this.close();
      this.trigger.focus();
      return;
    }

    if (this.menu.classList.contains("hidden")) this.open();
    const visible = this.visiblePapers();
    if (!visible.length) return;

    if (event.key === "ArrowDown") {
      this.activeIndex = (this.activeIndex + 1 + visible.length) % visible.length;
      this.renderList();
      this.scrollActiveIntoView();
    } else if (event.key === "ArrowUp") {
      this.activeIndex = (this.activeIndex - 1 + visible.length) % visible.length;
      this.renderList();
      this.scrollActiveIntoView();
    } else if (event.key === "Enter") {
      const paper = visible[this.activeIndex];
      if (paper) this.choose(paper.paper_id);
    }
  }

  scrollActiveIntoView() {
    const activeId = this.search.getAttribute("aria-activedescendant");
    if (!activeId) return;
    const active = this.list.ownerDocument.getElementById(activeId);
    active?.scrollIntoView({ block: "nearest" });
  }

  async choose(paperId) {
    if (this.loading) return;
    if (paperId === this.loadedPaperId && !this.retryRequired) {
      this.close();
      this.trigger.focus();
      return;
    }

    let failed = false;
    this.setLoading(true);
    try {
      await this.onSelect(paperId);
    } catch (error) {
      failed = true;
      this.markLoadFailed(paperId);
      await this.onError(error);
      this.renderList();
    } finally {
      this.setLoading(false);
    }

    if (failed) {
      this.search.focus();
      return;
    }

    this.markLoaded(paperId);
    this.close();
    this.trigger.focus();
  }

  setLoading(loading) {
    this.loading = loading;
    this.root.classList.toggle("is-loading", loading);
    this.trigger.disabled = loading;
    this.search.disabled = loading;
    this.menu.setAttribute("aria-busy", String(loading));
    this.list.setAttribute("aria-busy", String(loading));
    this.list.querySelectorAll(".paper-option").forEach((option) => {
      option.disabled = loading;
    });
  }

  renderTrigger() {
    this.trigger.replaceChildren();
    const paper = this.papers.find((item) => item.paper_id === this.selectedId);

    if (!paper) {
      appendTextElement(this.trigger, "span", "paper-trigger-empty", "暂无论文");
      this.trigger.removeAttribute("data-state");
      this.trigger.title = "切换论文 (Windows: Ctrl+P / Mac: ⌘P)";
      return;
    }

    this.trigger.dataset.state = paper.state.key;
    this.trigger.title = `${paper.title} · ${paper.paper_id}`;
    appendTextElement(this.trigger, "span", "paper-sequence", paper.sequence);
    appendTextElement(this.trigger, "span", "paper-state-dot", "");
    appendTextElement(this.trigger, "span", "paper-trigger-title truncated-title", paper.title);
    appendTextElement(this.trigger, "span", "paper-trigger-pct", `${paper.pct}%`);
    appendTextElement(this.trigger, "span", "paper-trigger-arrow", "▾");
  }

  renderList() {
    this.list.replaceChildren();
    const visible = this.visiblePapers();
    if (!visible.length) {
      appendTextElement(
        this.list,
        "div",
        "paper-no-results",
        this.papers.length ? "没有匹配的论文" : "暂无论文",
      );
      this.activeIndex = -1;
      this.search.removeAttribute("aria-activedescendant");
      return;
    }

    if (this.activeIndex < 0 || this.activeIndex >= visible.length) this.activeIndex = 0;
    visible.forEach((paper, index) => {
      const option = this.list.ownerDocument.createElement("button");
      option.type = "button";
      option.disabled = this.loading;
      option.className = "paper-option";
      option.id = `paper-option-${this.papers.indexOf(paper)}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(paper.paper_id === this.selectedId));
      option.dataset.state = paper.state.key;
      option.title = `${paper.title} · ${paper.paper_id}`;
      if (paper.paper_id === this.selectedId) option.classList.add("selected");
      if (index === this.activeIndex) option.classList.add("active");

      appendTextElement(option, "span", "paper-sequence", paper.sequence);
      appendTextElement(option, "span", "paper-state-dot", "");
      const details = option.ownerDocument.createElement("span");
      details.className = "paper-option-details";
      appendTextElement(details, "span", "paper-option-title truncated-title", paper.title);
      appendTextElement(details, "span", "paper-option-meta", `${paper.paper_id} · ${paper.done}/${paper.total}`);
      option.append(details);
      const progress = option.ownerDocument.createElement("span");
      progress.className = "paper-option-progress";
      appendTextElement(progress, "span", "paper-option-pct", `${paper.pct}%`);
      appendTextElement(progress, "span", "paper-state-label", paper.state.label);
      option.append(progress);
      option.addEventListener("click", () => this.choose(paper.paper_id));
      this.list.append(option);
    });

    if (this.menu.classList.contains("hidden")) {
      this.search.removeAttribute("aria-activedescendant");
    } else {
      this.search.setAttribute("aria-activedescendant", `paper-option-${this.papers.indexOf(visible[this.activeIndex])}`);
    }
  }
}
