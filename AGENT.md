# Evidence Note Viewer / Annotator

## 1. 模块定位

本项目是一个面向材料科学论文结构化抽取结果的人工审核 Viewer。它把抽取流水线的“机器结果 + 原文证据”组织成可操作的审核工作台，让人类逐字段判断：

- 机器抽取值是否正确；
- 字段是否需要修改或补充；
- 当前证据是否足够支持该值；
- 哪些字段存在冲突或需要二次复核。

它的核心产物不是普通的 JSON 编辑结果，而是一份带有原值、审核值、审核状态、证据引用、备注、指标和审计轨迹的人工反馈数据。

后续可以把本项目包装成 Agent 流程中的一个“人机协同审核环节”：上游 Agent 负责准备抽取包，下游 Agent 消费人工审核后的结构化结果；本 Viewer 负责把需要人判断的内容呈现出来并收集反馈。

## 2. 输入

### 2.1 论文级输入目录

默认从项目根目录的 `extracted/` 读取论文。每篇论文对应一个目录：

```text
extracted/<paper_id>/
├── extraction_postprocess/
│   ├── field_evidence.json       # 字段值、字段路径、证据引用、置信度
│   └── sample_buckets.json       # 论文级/样品级 bucket 划分
├── verify/
│   ├── text_extraction_fixed.json # 结构化抽取主结果
│   └── evidence_blocks.json       # 可定位的原文证据块
├── final/text_extraction.json     # verify 主结果不存在时的备用结果
├── source/mineru/
│   ├── *_origin.pdf               # 可选，PDF 原文预览
│   └── images/                     # 可选，图像资源
└── ...                            # 其他抽取流水线中间产物
```

论文只有在存在 `extraction_postprocess/field_evidence.json` 时才会被发现并展示。

### 2.2 结构化抽取结果

主结构通常是材料论文 schema 对应的 JSON，包含论文、合金、样品、工艺、组织、界面、性能、表征方法、计算细节等 section。系统会用 `docs/extraction_schema.json` 补齐 schema 中预定义但当前值为空的字段。

因此，Viewer 的审核单元不仅包括已有的非空字段，也包括显式的 `null` / 空数组 / 空对象槽位。这样人类可以确认“确实没有该信息”，也可以补充机器漏抽的字段。

### 2.3 字段证据

`field_evidence.json` 中的每个字段通常包含：

```json
{
  "field_id": "F00001",
  "section": "properties",
  "path": "properties.<property_id>.mechanical.tensile_properties.yield_strength[0].value",
  "value": 850,
  "support": {
    "support_label": "numeric_supported",
    "evidence_refs": ["b0042"],
    "confidence": 0.93,
    "contradiction": false,
    "reason": "...",
    "method": "..."
  }
}
```

其中 `path` 是抽取流水线使用的寻址路径；Viewer 内部会解析为稳定的 JSON Pointer，作为字段槽位 ID。`evidence_refs` 指向 `verify/evidence_blocks.json` 中的 `block_id`，用于左栏原文定位和高亮。

### 2.4 运行时输入

Viewer 还接收以下运行时输入：

- 用户登录凭据；
- 用户可审核的论文 assignment；
- 用户在审核过程中的字段状态、修改值、备注、证据引用覆盖和新增字段；
- 可选的 AI 助手对话消息及当前字段上下文。

## 3. 做了什么

### 3.1 构建可审核的字段槽位

后端 `app/enviz/slots.py` 会：

1. 读取结构化抽取 JSON；
2. 按 extraction schema 补齐缺失/null 槽位；
3. 遍历 JSON 的每个叶子节点；
4. 将每个叶子转成一个稳定的字段槽位；
5. 将字段挂接到原始 evidence 信息；
6. 按论文级或样品级 bucket 组织字段，并构建可折叠 JSON 树。

槽位是 Viewer 的最小审核单元。它通常包含：

```json
{
  "field_id": "/properties/0/mechanical/tensile_properties/yield_strength/0/value",
  "pointer": ["properties", 0, "mechanical", "tensile_properties", "yield_strength", 0, "value"],
  "section": "properties",
  "label": "value",
  "path": "properties.<property_id>.mechanical...value",
  "value": 850,
  "evidence_refs": ["b0042"],
  "support_label": "numeric_supported",
  "confidence": 0.93,
  "contradiction": false,
  "reason": "...",
  "no_evidence": false,
  "tracked": true
}
```

### 3.2 呈现原文与证据

界面采用三栏布局：

- 左栏：证据原文，按 evidence block 展示并支持高亮；若存在 PDF，也提供 PDF 原文预览；
- 中栏：按 bucket 和 schema 组织的 JSON 树，字段是可选中的叶子节点；
- 右栏：当前字段的值、原始值、证据、支持度、置信度、备注和审核操作。

字段选中后，系统会联动定位其 evidence block；一个字段可以引用多个证据块，并支持在多个证据之间切换。证据不存在或引用为空时，会明确显示“缺证据”，不会静默当作已支持。

### 3.3 收集人类判断

字段审核状态：

| 状态 | 含义 | 典型动作 |
|---|---|---|
| `unprocessed` | 尚未判断 | 默认状态 |
| `confirmed` | 接受机器抽取值 | 值正确且证据足够 |
| `modified` | 修改机器抽取值 | 值错误、格式不对或需要补全 |
| `added` | 人工新增字段 | 原结构中没有，但原文存在该信息 |
| `needs_review` | 暂不确定，交给复核 | 证据不足或需要领域专家判断 |
| `conflict` | 与原文或上下文冲突 | 机器值明显不成立 |

修改值时会保留原值；人工可以覆盖证据引用并添加备注。新增字段会记录所在 bucket、section、父节点和路径信息。

### 3.4 保存与任务状态

标注状态按用户隔离，默认保存到：

```text
data/users/<username>/annotations/<paper_id>.json
```

支持自动保存、手动暂存、撤销/重做和任务状态：

- `not_started`
- `in_progress`
- `submitted`

annotation 文档的核心结构如下：

```json
{
  "paper_id": "10.xxxx",
  "schema_version": "...",
  "task_status": "in_progress",
  "fields": {
    "/papers/0/title": {
      "review_status": "modified",
      "current_value": "人工确认后的标题",
      "note": "原抽取值缺少副标题",
      "evidence_refs_override": ["b0001"]
    }
  },
  "added_fields": [],
  "buckets": {},
  "audit_log": []
}
```

### 3.5 计算质量指标

系统以“人工审核结果”为 golden，以“原始抽取结果”为 prediction，按字段槽位计算：

- TP：非空机器值被确认；
- TN：空槽位被确认为空，不计入 P/R；
- FP：错误机器值被修改/冲突；
- FN：机器漏抽、人工从空补成有值，或错误值被替换；
- `needs_review` 和 `unprocessed`：视为 pending，不进入 P/R/F1，但计入覆盖率。

指标提供总体结果和按 section 的 Precision、Recall、F1，以及审核覆盖率、pending 数量、TN 和新增字段数量。

## 4. 输出

### 4.1 过程输出

Viewer 的 API 返回一篇论文的审核工作区数据：

```json
{
  "paper_id": "10.xxxx",
  "meta": {"title": "...", "doi": "...", "field_count": 189},
  "blocks": [],
  "fields": [],
  "buckets": [],
  "annotation": {},
  "progress": {},
  "has_pdf": true,
  "pdf_url": "/api/papers/10.xxxx/pdf"
}
```

这份数据用于驱动 UI，不建议直接作为下游 Agent 的最终消费格式。

### 4.2 最终导出包

通过导出接口生成 `<paper_id>_annotation_export.zip`，包内包含：

```text
<paper_id>/
├── MANIFEST.json
├── review_summary.md
├── annotation_state.json
├── field_review.json
├── text_extraction.reviewed.json
├── diff.json
├── evaluation_metrics.json
└── audit_log.jsonl
```

各文件用途：

- `field_review.json`：权威机器消费文件。逐字段包含 slot ID、JSON pointer、原始值、审核值、状态、证据引用、支持标签、置信度和备注；
- `text_extraction.reviewed.json`：将修改后的值精确回填到结构化 JSON 后的结果；
- `diff.json`：原值到审核值的变化集；
- `evaluation_metrics.json`：总体和分 section 的质量指标；
- `annotation_state.json`：可继续回灌 Viewer 的完整标注状态；
- `audit_log.jsonl`：追加式审核事件记录；
- `review_summary.md`：供人阅读的审核摘要、指标、变更和新增字段；
- `MANIFEST.json`：任务状态、进度、文件清单、导出人、指标和未应用编辑说明。

后续 Agent 默认应优先消费 `field_review.json`；如果需要完整结构，则消费 `text_extraction.reviewed.json`；如果需要判断人工做了什么，则消费 `diff.json` 和 `audit_log.jsonl`。

## 5. 现有 HTTP 接口

除登录接口外，所有论文数据接口需要登录，并且只允许访问当前用户被分配的论文。

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/papers` | 获取当前用户可审核的论文及进度 |
| `GET` | `/api/papers/{paper_id}` | 获取论文元数据、证据块、字段槽位、bucket、标注状态 |
| `PUT` | `/api/papers/{paper_id}/annotation` | 保存完整 annotation 文档 |
| `GET` | `/api/papers/{paper_id}/metrics` | 获取实时指标 |
| `GET` | `/api/papers/{paper_id}/pdf` | 获取论文 PDF |
| `GET` | `/api/papers/{paper_id}/asset/{path}` | 获取论文图片等资源 |
| `GET` | `/api/papers/{paper_id}/export` | 导出当前论文 ZIP |
| `GET` | `/api/export/all` | 导出当前用户所有已分配论文 |
| `POST` | `/api/assistant` | 调用 AI 助手或内置 FAQ |
| `GET` | `/api/manual` | 获取用户手册 |
| `GET` | `/api/health` | 健康检查 |

登录相关接口为：`GET /api/auth/me`、`POST /api/auth/login`、`POST /api/auth/logout`。

## 6. 作为 Agent 模块的推荐封装

### 6.1 模块职责

建议将 viewer 封装成一个有明确暂停点的 `human_review` 模块：

```text
上游抽取 Agent
    ↓ 生成 extracted/<paper_id>/ 输入包
human_review Viewer
    ↓ 等待人类审核/提交
下游 Agent
    ↓ 消费 field_review.json 或 reviewed JSON
```

Viewer 不负责重新抽取论文、不负责替代领域判断，也不应在没有人类确认时自动把 `unprocessed` 当成正确结果。

### 6.2 建议的模块输入契约

后续 Agent 可以将输入抽象成：

```json
{
  "paper_id": "10.xxxx",
  "workspace": "optional-workspace",
  "input_dir": "extracted/10.xxxx",
  "reviewer": "annotator1",
  "assignment": {"paper_ids": ["10.xxxx"]},
  "review_policy": {
    "require_all_fields_reviewed": false,
    "allow_export_with_pending": true,
    "focus_statuses": ["unprocessed", "needs_review", "conflict"]
  }
}
```

实际接入时，`input_dir` 至少需要满足 §2 的目录和文件约定。若上游 schema 或字段路径发生变化，应同步更新 schema、path 解析和 evidence mapping，不要只修改前端展示。

### 6.3 建议的模块输出契约

模块结束时建议返回：

```json
{
  "status": "submitted",
  "paper_id": "10.xxxx",
  "export_path": ".../10.xxxx_annotation_export.zip",
  "authoritative_file": ".../field_review.json",
  "reviewed_json": ".../text_extraction.reviewed.json",
  "diff_file": ".../diff.json",
  "metrics_file": ".../evaluation_metrics.json",
  "audit_log": ".../audit_log.jsonl",
  "progress": {
    "total": 189,
    "reviewed": 180,
    "pending": 9,
    "reviewed_pct": 95.2
  },
  "human_feedback_summary": {
    "confirmed": 150,
    "modified": 20,
    "added": 5,
    "needs_review": 8,
    "conflict": 1
  }
}
```

推荐使用以下结束语义：

- `submitted`：人类明确提交，允许下游 Agent 继续；
- `in_progress`：已有部分反馈，但不能视为审核完成；
- `blocked`：需要人类补充判断或输入包不完整；
- `cancelled`：用户取消本轮审核。

### 6.4 下游消费规则

下游 Agent 应遵循：

1. 以 `review_status` 判断人工意图，而不是只比较值；
2. `confirmed` 才表示人类接受原值；
3. `modified` 使用 `reviewed_value`，同时保留原值和变更原因；
4. `added` 从 `added_fields` 读取；
5. `needs_review`、`conflict` 和 `unprocessed` 不应无提示地进入高置信度结论；
6. 需要审计时读取 `audit_log.jsonl`；
7. 需要完整结构时使用 `text_extraction.reviewed.json`，需要逐字段可追溯性时使用 `field_review.json`。

## 7. 启动与验证

启动：

```bash
./run.sh
```

默认地址：`http://127.0.0.1:8765`。`run.sh` 会在 `app/.venv` 创建环境并安装 `app/requirements.txt`。

测试：

```bash
python3 -m unittest discover -s tests
```

主要代码位置：

- `app/enviz/server.py`：FastAPI 路由和接口编排；
- `app/enviz/slots.py`：字段槽位、bucket 和 JSON 树；
- `app/enviz/evidence.py`：证据块和 PDF 资源；
- `app/enviz/annotations.py`：标注状态持久化；
- `app/enviz/metrics.py`：质量指标；
- `app/enviz/export.py`：导出包；
- `app/static/js/`：前端状态、树、证据和 Inspector 交互。

## 8. 当前边界与注意事项

- 当前系统是本地/轻量服务，虽然已有用户、workspace 和 assignment 隔离，但不是完整的多人实时协作系统；
- 标注保存是“完整 annotation 文档”覆盖式保存，后续若接入多 Agent 或多人协作，需要考虑版本号、并发冲突和幂等提交；
- evidence block 的精确高亮依赖字段 evidence_ref 与 `verify/evidence_blocks.json` 一致；
- schema 补齐会增加大量 null 槽位，输入字段总数不一定等于原始 `field_evidence.json` 的 `field_count`；
- `field_review.json` 是最稳定的下游接口，不能只依赖 UI 当前显示文本；
- 导出允许在存在 pending 字段时继续，但是否允许下游继续应由 Agent 的 review policy 决定；
- AI 助手是辅助解释入口，不是审核决策来源。未配置外部 provider 时会降级到内置 FAQ；
- 论文 PDF 和图片是可选输入，没有 PDF 时仍可通过证据原文完成审核。

