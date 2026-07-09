"""In-app help assistant.

Two layers:
  1. **Live LLM** — if a usable DeepSeek-compatible endpoint is configured,
     questions are answered by the model, including materials-science domain
     questions.
  2. **Local FAQ fallback** — a built-in keyword responder for common
     system-operation questions, drawn from the user manual. Always available,
     so the assistant is useful even with no LLM endpoint / no network.

Environment (all optional; first found wins):
    ENVIZ_ASSISTANT_BASE_URL | DEEPSEEK_BASE_URL   (default api.deepseek.com)
    ENVIZ_ASSISTANT_API_KEY  | DEEPSEEK_API_KEY
    ENVIZ_ASSISTANT_MODEL    (default deepseek-v4-flash)
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

SYSTEM_PROMPT = """\
你是"证据标注工具 (Evidence Note Annotator)"内置的 AI 助手，服务于材料科学论文\
结构化抽取结果的人工审核工作。用简洁、专业、可操作的中文回答（通常 2-6 句）。

系统关键概念：
- 左：证据原文/PDF；中：按 schema 还原的可折叠 JSON 树（含预定义 null 字段）；右：字段详情。
- 审核状态（颜色）：未处理/已确认(绿)/已修改(蓝)/已补充(紫)/待复核(琥珀)/冲突(红)；证据质量用徽章。
- 点字段→左侧自动高亮其 evidence 证据块；多证据用 n/N 切换。
- 补充遗漏字段：在 JSON 树目标节点点 ＋，就地填 key/value。
- 指标：golden=人工、pred=原始抽取；TP=已确认非空，FP=已修改/冲突，FN=漏抽被补齐；null 参与召回。
- 快捷键：j/k 移动，c 确认，x 冲突，r 待复核，e 编辑，/ 搜索，⌘S 暂存。
你可以回答系统操作、材料领域知识、以及具体字段的标注判断。不要编造不存在的功能。"""

# ---- config --------------------------------------------------------------- #
def _cfg():
    base = (os.environ.get("ENVIZ_ASSISTANT_BASE_URL")
            or os.environ.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com")
    token = (os.environ.get("ENVIZ_ASSISTANT_API_KEY")
             or os.environ.get("DEEPSEEK_API_KEY"))
    model = os.environ.get("ENVIZ_ASSISTANT_MODEL", "deepseek-v4-flash")
    return base.rstrip("/"), token, model


def available() -> bool:
    """FAQ is always available; the assistant endpoint therefore always responds."""
    return True


def _llm(messages: list[dict], context: str):
    base, token, model = _cfg()
    if not token:
        return None
    system = SYSTEM_PROMPT + (f"\n\n当前上下文：\n{context}" if context else "")
    clean = [{"role": m["role"], "content": str(m.get("content", ""))}
             for m in messages if m.get("role") in ("user", "assistant")][-12:]
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}] + clean,
        "max_tokens": 1024,
        "stream": False,
    }).encode("utf-8")
    headers = {"content-type": "application/json", "authorization": f"Bearer {token}"}
    req = urllib.request.Request(_chat_url(base), data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        text = data["choices"][0]["message"].get("content", "").strip()
        return text or None
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
        return None


def _chat_url(base: str) -> str:
    if base.endswith("/chat/completions"):
        return base
    return base.rstrip("/") + "/chat/completions"


# ---- local FAQ fallback --------------------------------------------------- #
_FAQ = [
    (("补充", "遗漏", "漏", "新增", "添加字段", "缺字段"),
     "补齐遗漏字段：在中间 JSON 树里，把鼠标移到要补充的那一层节点，点出现的 ＋，就地填写「字段名 / 值」即可。新字段显示为紫色「已补充」，并计入召回(Recall)。"),
    (("修改", "改值", "纠错", "错误", "改错"),
     "修正错误字段：点该字段→在右侧「当前值」框直接改，回车保存，状态变「已修改」，原值仍会保留在导出里。改回原值会自动恢复为未处理。"),
    (("冲突", "待复核", "区别"),
     "「冲突」= 该字段的值与原文矛盾/错误（红色，计入 FP）；「待复核」= 你暂时拿不准、留给二次复核（琥珀色，不计入 P/R）。快捷键：x=冲突，r=待复核。"),
    (("确认", "正确", "接受"),
     "核对无误就点「✓ 确认」或按 c，该字段计为正确(TP)。非空字段确认=TP，空字段确认=TN(不计入 P/R)。"),
    (("证据", "高亮", "定位", "原文", "evidence"),
     "点任一字段，左侧「证据原文」会自动滚动并高亮它引用的证据块；多条证据用 n/N 切换。若定位不到，可在右侧手动修改证据块 ID，或切到「PDF 原文」对照。"),
    (("快捷键", "键盘", "shortcut"),
     "常用快捷键：j/k 上下移动，c 确认，x 冲突，r 待复核，e 编辑值，n/N 切换多证据，/ 搜索，⌘/Ctrl+Z 撤销，⌘/Ctrl+S 暂存，? 打开帮助。"),
    (("导出", "下载", "export"),
     "点顶栏「导出」下载 zip：含 field_review.json（权威扁平结果）、evaluation_metrics.json（P/R/F1）、text_extraction.reviewed.json（回填后的结构化 JSON）、diff.json、审计日志等。"),
    (("指标", "precision", "recall", "f1", "召回", "准确"),
     "指标以人工标注为 golden、原始抽取为 pred：TP=已确认非空，FP=已修改+冲突，FN=补齐的空槽+已补充字段，TN=确认为空。P=TP/(TP+FP)，R=TP/(TP+FN)。待复核/未处理不计入。点顶栏「指标」查看。"),
    (("null", "空", "预定义", "没有值"),
     "值为「（空）」的是 schema 预定义字段，也要审核：若原文确实没有→确认(计 TN)；若原文其实有→当作遗漏补上(计入召回)。"),
    (("保存", "暂存", "草稿", "丢失"),
     "系统每次操作自动保存到 annotations/；也可点「暂存」或 ⌘/Ctrl+S 立即存草稿。数据跨重启保留，不会丢。"),
    (("pdf", "原文pdf", "看论文"),
     "左栏「PDF 原文」标签内嵌了论文 PDF，可与证据/字段对照阅读。"),
    (("撤销", "重做", "undo", "恢复"),
     "撤销 ⌘/Ctrl+Z，重做 ⌘/Ctrl+Shift+Z（最多 100 步）；也可在右侧点「重置」把某字段还原为未处理。"),
    (("怎么开始", "流程", "如何标注", "第一次", "上手"),
     "流程：选论文→选字段(左侧自动高亮证据)→对照判断：确认/修改/待复核/冲突，遗漏就用 ＋ 补齐→自动暂存→全部完成后导出。可先读『用户手册』标签。"),
]


def _faq(question: str):
    q = question.lower()
    for keys, ans in _FAQ:
        if any(k.lower() in q for k in keys):
            return ans
    return None


# ---- entry ---------------------------------------------------------------- #
def ask(messages: list[dict], context: str = "") -> dict:
    reply = _llm(messages, context)
    if reply:
        return {"ok": True, "reply": reply, "source": "ai"}

    last = next((m.get("content", "") for m in reversed(messages)
                 if m.get("role") == "user"), "")
    hit = _faq(str(last))
    if hit:
        return {"ok": True, "reply": hit, "source": "faq"}
    return {
        "ok": True, "source": "faq",
        "reply": ("我可以帮你解答系统操作（如何确认/修改/补充/标记、证据高亮、导出、指标、快捷键等）。"
                  "请换个说法或更具体地问，也可以点上方『用户手册』通读。\n\n"
                  "（提示：如需回答材料领域等开放性问题，请为服务配置可用的 LLM 端点："
                  "设置环境变量 DEEPSEEK_API_KEY，或 ENVIZ_ASSISTANT_BASE_URL / "
                  "ENVIZ_ASSISTANT_API_KEY / ENVIZ_ASSISTANT_MODEL 后重启。）"),
    }
