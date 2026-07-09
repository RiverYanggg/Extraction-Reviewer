// Draggable floating window: AI assistant + user manual.
import { el, ui } from "./dom.js";
import { store } from "./store.js";
import { api } from "./api.js";
import { markdown, esc } from "./util.js";

const chat = [];          // {role, content}
let manualLoaded = false;

export function initFloating() {
  el.fab.addEventListener("click", () => toggleWin(true));
  el.floatMin.addEventListener("click", () => toggleWin(false));

  document.querySelectorAll(".float-tab").forEach((t) =>
    t.addEventListener("click", () => switchFloatTab(t.dataset.ftab)));

  el.chatSend.addEventListener("click", send);
  el.chatText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  makeDraggable(el.floatWin, el.floatHead);
  makeResizable(el.floatWin, el.floatResize);
  greet();
}

function toggleWin(show) {
  el.floatWin.classList.toggle("hidden", !show);
  el.fab.classList.toggle("hidden", show);
}

function switchFloatTab(tab) {
  document.querySelectorAll(".float-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.ftab === tab));
  el.floatAssistant.classList.toggle("hidden", tab !== "assistant");
  el.floatManual.classList.toggle("hidden", tab !== "manual");
  if (tab === "manual") loadManual();
}

async function loadManual() {
  if (manualLoaded) return;
  try {
    const { markdown: md } = await api.manual();
    el.manualView.innerHTML = markdown(md);
    manualLoaded = true;
  } catch (e) {
    el.manualView.innerHTML = `<p>手册加载失败：${esc(e.message)}</p>`;
  }
}

function greet() {
  addBubble("bot",
    "你好！我是标注助手。可以问我：\n· 系统怎么操作（补充/修改/冲突/导出/指标…）\n· 材料领域概念\n· 某个字段抽得对不对\n也可点上方「用户手册」通读。", "");
}

function addBubble(role, text, source) {
  const div = document.createElement("div");
  div.className = "chat-msg " + (role === "user" ? "user" : "bot");
  div.textContent = text;
  if (role === "bot" && source) {
    const s = document.createElement("span");
    s.className = "src";
    s.textContent = source === "ai" ? "AI 回答" : "内置帮助 (FAQ)";
    div.appendChild(s);
  }
  el.chatLog.appendChild(div);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  return div;
}

function currentContext() {
  const fid = ui.selectedFieldId;
  if (!fid || !store.data || !store.fieldIndex[fid]) return "";
  const f = store.fieldIndex[fid];
  const refs = store.effectiveRefs(f);
  const evText = refs.map((r) => store.blockIndex[r]?.text).filter(Boolean).join(" | ").slice(0, 500);
  return `当前论文：${store.data.meta?.title || store.paperId}\n` +
         `当前字段路径：${f.path}\n当前值：${store.currentValue(f)}\n` +
         `审核状态：${store.statusOf(fid)}\n证据原文：${evText || "（无）"}`;
}

async function send() {
  const text = el.chatText.value.trim();
  if (!text) return;
  el.chatText.value = "";
  addBubble("user", text);
  chat.push({ role: "user", content: text });

  const typing = addBubble("bot", "思考中…");
  typing.classList.add("typing");
  el.chatSend.disabled = true;
  try {
    const r = await api.assistant(chat, store.paperId, currentContext());
    typing.remove();
    addBubble("bot", r.reply, r.source);
    chat.push({ role: "assistant", content: r.reply });
  } catch (e) {
    typing.remove();
    addBubble("bot", "请求失败：" + e.message);
  } finally {
    el.chatSend.disabled = false;
    el.chatText.focus();
  }
}

// ---- drag / resize --------------------------------------------------------
function makeDraggable(win, handle) {
  handle.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    const r = win.getBoundingClientRect();
    const offX = e.clientX - r.left, offY = e.clientY - r.top;
    win.style.right = "auto"; win.style.bottom = "auto";
    const move = (ev) => {
      win.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - offX)) + "px";
      win.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - offY)) + "px";
    };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  });
}

function makeResizable(win, grip) {
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const r = win.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY, w0 = r.width, h0 = r.height, left0 = r.left;
    win.style.right = "auto";
    const move = (ev) => {
      const dw = startX - ev.clientX;          // grip is on the left edge
      const dh = ev.clientY - startY;          // grip is on the bottom edge
      const w = Math.max(300, w0 + dw), h = Math.max(260, h0 + dh);
      win.style.width = w + "px"; win.style.height = h + "px";
      win.style.left = (left0 - (w - w0)) + "px";
    };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  });
}
