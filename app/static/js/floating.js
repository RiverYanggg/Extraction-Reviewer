// Draggable floating window: AI assistant + user manual.
import { el, ui } from "./dom.js";
import { store } from "./store.js";
import { api } from "./api.js";
import { markdown, esc } from "./util.js";

const CHAT_KEY = "enviz.assistant.sessions.v1";
const WINDOW_KEY = "enviz.float.window.v1";

let sessions = [];
let activeSessionId = "";
let manualLoaded = false;

export function initFloating() {
  loadSessions();
  restoreWindowPlacement();
  el.fab.addEventListener("click", () => toggleWin(true));
  el.floatMin.addEventListener("click", () => toggleWin(false));

  document.querySelectorAll(".float-tab").forEach((t) =>
    t.addEventListener("click", () => switchFloatTab(t.dataset.ftab)));

  el.chatNew.addEventListener("click", newSession);
  el.chatSession.addEventListener("change", () => {
    activeSessionId = el.chatSession.value;
    saveSessions();
    renderChat();
  });
  el.chatSend.addEventListener("click", send);
  el.chatText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  makeDraggable(el.floatWin, el.floatHead);
  makeResizable(el.floatWin, el.floatResize);
  renderSessionPicker();
  renderChat();
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

function greeting() {
  return {
    role: "assistant",
    content: "你好！我是标注助手。可以问我：\n· 系统怎么操作（补充/修改/冲突/导出/指标…）\n· 材料领域概念\n· 某个字段抽得对不对\n也可点上方「用户手册」通读。",
    source: "",
    local: true,
  };
}

function loadSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_KEY) || "null");
    if (saved?.sessions?.length) {
      sessions = saved.sessions.filter((s) => Array.isArray(s.messages));
      activeSessionId = saved.activeSessionId || sessions[0]?.id || "";
    }
  } catch {
    sessions = [];
  }
  if (!sessions.length) {
    sessions = [createSession()];
    activeSessionId = sessions[0].id;
  }
}

function saveSessions() {
  localStorage.setItem(CHAT_KEY, JSON.stringify({ sessions, activeSessionId }));
}

function createSession() {
  const now = Date.now();
  return {
    id: `chat-${now}-${Math.random().toString(16).slice(2)}`,
    title: "新对话",
    updatedAt: now,
    messages: [greeting()],
  };
}

function currentSession() {
  let session = sessions.find((s) => s.id === activeSessionId);
  if (!session) {
    session = sessions[0] || createSession();
    sessions = sessions.length ? sessions : [session];
    activeSessionId = session.id;
  }
  return session;
}

function newSession() {
  const session = createSession();
  sessions.unshift(session);
  activeSessionId = session.id;
  saveSessions();
  renderSessionPicker();
  renderChat();
  el.chatText.focus();
}

function titleFrom(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 22) : "新对话";
}

function renderSessionPicker() {
  el.chatSession.innerHTML = sessions
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((s) => `<option value="${esc(s.id)}">${esc(s.title || "新对话")}</option>`)
    .join("");
  el.chatSession.value = activeSessionId;
}

function renderChat() {
  el.chatLog.innerHTML = "";
  for (const msg of currentSession().messages) {
    addBubble(msg.role === "user" ? "user" : "bot", msg.content, msg.source);
  }
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
  const session = currentSession();
  el.chatText.value = "";
  addBubble("user", text);
  session.messages.push({ role: "user", content: text });
  if (session.title === "新对话") session.title = titleFrom(text);
  session.updatedAt = Date.now();
  saveSessions();
  renderSessionPicker();

  const typing = addBubble("bot", "思考中…");
  typing.classList.add("typing");
  el.chatSend.disabled = true;
  try {
    const history = session.messages
      .filter((m) => !m.local && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: m.content }));
    const r = await api.assistant(history, store.paperId, currentContext());
    typing.remove();
    addBubble("bot", r.reply, r.source);
    session.messages.push({ role: "assistant", content: r.reply, source: r.source });
    session.updatedAt = Date.now();
    saveSessions();
    renderSessionPicker();
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
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const r = win.getBoundingClientRect();
    const offX = e.clientX - r.left, offY = e.clientY - r.top;
    win.style.right = "auto"; win.style.bottom = "auto";
    const move = (ev) => {
      const x = clamp(ev.clientX - offX, 8, window.innerWidth - r.width - 8);
      const y = clamp(ev.clientY - offY, 8, window.innerHeight - r.height - 8);
      win.style.left = x + "px";
      win.style.top = y + "px";
    };
    const up = () => {
      saveWindowPlacement();
      handle.releasePointerCapture(e.pointerId);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  });
}

function makeResizable(win, grip) {
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const r = win.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY, w0 = r.width, h0 = r.height, left0 = r.left;
    win.style.right = "auto";
    const move = (ev) => {
      const dw = startX - ev.clientX;          // grip is on the left edge
      const dh = ev.clientY - startY;          // grip is on the bottom edge
      const w = clamp(w0 + dw, 300, window.innerWidth - 16);
      const h = clamp(h0 + dh, 260, window.innerHeight - 16);
      win.style.width = w + "px"; win.style.height = h + "px";
      win.style.left = clamp(left0 - (w - w0), 8, window.innerWidth - w - 8) + "px";
    };
    const up = () => {
      saveWindowPlacement();
      grip.releasePointerCapture(e.pointerId);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function saveWindowPlacement() {
  const r = el.floatWin.getBoundingClientRect();
  localStorage.setItem(WINDOW_KEY, JSON.stringify({
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
  }));
}

function restoreWindowPlacement() {
  try {
    const saved = JSON.parse(localStorage.getItem(WINDOW_KEY) || "null");
    if (!saved) return;
    const width = clamp(Number(saved.width) || 420, 300, window.innerWidth - 16);
    const height = clamp(Number(saved.height) || 520, 260, window.innerHeight - 16);
    el.floatWin.style.width = width + "px";
    el.floatWin.style.height = height + "px";
    el.floatWin.style.left = clamp(Number(saved.left) || 8, 8, window.innerWidth - width - 8) + "px";
    el.floatWin.style.top = clamp(Number(saved.top) || 8, 8, window.innerHeight - height - 8) + "px";
    el.floatWin.style.right = "auto";
    el.floatWin.style.bottom = "auto";
  } catch {
    localStorage.removeItem(WINDOW_KEY);
  }
}
