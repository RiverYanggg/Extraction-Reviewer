# 重要输出文件说明

本文档基于以下真实输出目录整理：

- 示例论文 1：`10.1016_j.matlet.2024.136522`
- 示例论文 2：`10.1016_j.msea.2007.01.014`

适用场景：

- 想快速判断整批是否跑完
- 想定位单篇论文的最终结果
- 想追踪某条结构化字段是怎么来的
- 想检查 verify 是否修复了抽取结果

## 1. 先看哪些文件

如果只想快速用结果，建议按这个顺序看：

1. `batch_pipeline_report.json`
2. `<paper_id>/final/text_extraction.json`
3. `<paper_id>/final/text_knowledge.md`
4. `<paper_id>/final/multimodal_figures.json`
5. `<paper_id>/verify/text_extraction_fixed.json`
6. `<paper_id>/verify/verify_report.json`

## 2. 批量级文件

### `batch_pipeline_report.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/batch_pipeline_report.json`

作用：

- 看整批任务是否成功
- 看一共处理了多少篇、成功多少篇、失败多少篇
- 看运行参数，例如 `workers`、`modules`、`knowledge_mode`

本次实际字段示例：

- `mode: paper_parallel_full_pipeline`
- `paper_count: 2`
- `workspace_root: /Users/mac/Desktop/evidence_note_viewer/extracted`

什么时候看它：

- 跑完后第一眼确认任务状态
- 回溯某次批处理的配置

## 3. 单篇论文最重要的结果文件

下面用 `10.1016_j.matlet.2024.136522` 举例。

### `final/text_extraction.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/final/text_extraction.json`

作用：

- 这是单篇论文最核心的结构化抽取结果
- 供下游知识图谱、评估、人工校对直接使用

本次实际顶级键示例：

- `papers`
- `alloys`
- `processes`
- `samples`
- `processing_steps`
- `structures`
- `interfaces`
- `properties`
- `performance`
- `characterization_methods`
- `computational_details`
- `unmapped_findings`

如何理解：

- `papers` 是论文级元数据
- `samples` 是样品主索引
- `processing_steps`、`structures`、`properties` 是最常用的三块
- `unmapped_findings` 存放暂时塞不进 schema、但仍有价值的信息

什么时候看它：

- 你要“拿结果做事”的时候，优先看这个文件
- 想检查抽取质量时，也先从这里开始

### `final/text_knowledge.md`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/final/text_knowledge.md`

作用：

- 这是面向阅读的知识总结版本
- 比 JSON 更适合人快速理解论文主线

这个例子里包含的典型章节有：

- `Material System`
- `Processing Route and Variables`
- `Microstructure and Phase Evolution`
- `Processing-Structure-Property Chain`
- `Mechanistic Interpretation`
- `Key Quantitative Findings`
- `Visual Evidence`

适合用途：

- 快速浏览一篇论文讲了什么
- 做人工 spot check
- 给后续报告、综述或知识整理做输入

### `final/text_knowledge.meta.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/final/text_knowledge.meta.json`

作用：

- 记录 `text_knowledge.md` 的生成元信息
- 用来追踪来源、模型和 claim 数量

本次实际字段示例：

- `paper_id`
- `source_md_path`
- `cleaned_md_path`
- `model`
- `created_at`
- `claim_count`
- `source_type`
- `paper_map`

什么时候看它：

- 需要做可追溯性排查时
- 需要知道 knowledge 阶段到底吃的是哪份输入时

### `final/multimodal_figures.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/final/multimodal_figures.json`

作用：

- 存放图像级结构化结果
- 每条记录通常对应一张 Figure 或一组子图

本次实际每条记录的字段示例：

- `paper_id`
- `figure_id`
- `image_paths`
- `image_count`
- `image_type`
- `description`
- `confidence`

什么时候看它：

- 你关心图像证据、图类型分类、图像描述时
- 想把论文中的 figure 信息接入后续多模态系统时

### `final/text_claims.jsonl`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/final/text_claims.jsonl`

作用：

- 存放按行组织的 claim 级结果
- 比整篇 `text_knowledge.md` 更适合做检索、切片、索引

什么时候看它：

- 做 claim 检索
- 做知识库入库
- 需要更细粒度的断言单位时

## 4. 输入清洗与预处理文件

### `run_manifest.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/run_manifest.json`

作用：

- 这是单篇 workspace 的总清单
- 记录导入来源、落盘产物和目录布局

本次实际关键信息示例：

- `paper_id: 10.1016_j.matlet.2024.136522`
- `import.kind: mineru_input`
- `import.source_dir`: 指向原始 MinerU 目录
- `import.markdown_origin`: 指向原始 `full.md`
- `artifacts`: 记录 `source/mineru`、`preprocess/cleaned_input.md` 等产物

什么时候看它：

- 想确认这篇论文到底是从哪里导入的
- 想做目录级可追溯性检查

### `preprocess/cleaned_input.md`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/preprocess/cleaned_input.md`

作用：

- 这是进入抽取模型前的清洗版 Markdown
- 很多文本抽取问题，根源都可以在这里定位

什么时候看它：

- 发现样品名丢失、表格信息缺失、段落顺序异常时
- 想判断是 MinerU 输入问题还是抽取问题时

### `preprocess/summary.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/preprocess/summary.json`

作用：

- 记录预处理是否用了 content list、去掉了多少参考文献块、识别了多少图组

本次实际字段示例：

- `used_content_list: true`
- `removed_categories.ref_text: 18`
- `removed_blocks: 18`
- `reference_count: 18`
- `image_group_count: 3`

什么时候看它：

- 想判断清洗过程删掉了什么
- 想确认图像分组是否被正确识别

### `preprocess/image_groups.json`

作用：

- 存放预处理阶段识别到的图组
- 是多模态抽取的重要中间输入

## 5. 验证与修复相关文件

### `verify/text_extraction_fixed.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/verify/text_extraction_fixed.json`

作用：

- 这是 verify 阶段修复后的最终结构化 JSON
- 在“要求更稳、更保守”的场景下，通常比 `final/text_extraction.json` 更适合下游消费

使用建议：

- 如果你只取一份结构化 JSON 给下游，优先考虑这份
- 但如果你在分析抽取原始输出与修复差异，就要同时看 `final/text_extraction.json`

### `verify/verify_report.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/verify/verify_report.json`

作用：

- 记录 verify 阶段做了什么修复
- 说明修复前后的目标文件、是否用了 LLM、接受了哪些 patch

本次实际字段示例：

- `target_path`
- `fixed_path`
- `target_kind: normalized_units`
- `llm_used: true`
- `summary`
- `before_validation`
- `after_validation`
- `accepted_patches`
- `rejected_patches`

什么时候看它：

- 想知道 verify 是否真的改了结果
- 想审计某次修复是否合理

### `verify_pipeline_report.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/verify_pipeline_report.json`

作用：

- 这是单篇 verify 链的阶段级总报告
- 比 `verify_report.json` 更偏流程状态汇总

### `verify/patches/*.patch.json`

作用：

- 逐样品记录修复 patch
- 适合追踪某个 `sample_id` 被怎么修改

例子：

- `verify/patches/sample_0cu_sol_aged.patch.json`
- `verify/patches/sample_3cu_sol_aged.patch.json`

### `verify/sample_inputs/*.json`

作用：

- verify 阶段喂给模型或规则系统的样品输入包
- 适合排查“为什么这个样品被这样修”

### `verify/sample_raw_outputs/*.json`

作用：

- verify 阶段每个样品的原始输出
- 适合做模型行为排查

## 6. 单位归一化与证据对齐文件

### `normalized/text_extraction_units.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/normalized/text_extraction_units.json`

作用：

- 对 `final/text_extraction.json` 做单位归一化后的版本
- verify 通常就是基于这份继续修

### `normalized/unit_normalization_report.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/normalized/unit_normalization_report.json`

作用：

- 记录哪些数值或单位发生了标准化

本次实际字段示例：

- `target_unit_policy`
- `summary`
- `changes`

适合用途：

- 审计单位转换
- 确认温度、时间、应力等字段的归一化策略

### `extraction_postprocess/field_evidence.json`

路径：

- `/Users/mac/Desktop/evidence_note_viewer/extracted/10.1016_j.matlet.2024.136522/extraction_postprocess/field_evidence.json`

作用：

- 把结构化字段和原始文本证据块对齐
- 是“字段为什么这样填”的重要依据

### `extraction_postprocess/sample_buckets.json`

作用：

- 按 `sample_id` 聚合字段与证据
- 适合样品级人工核对

### `extraction_postprocess/summary.json`

作用：

- 给出证据后处理阶段的统计摘要

本次实际字段示例：

- `field_count: 189`
- `bucket_count: 3`
- `llm_used: true`
- `support_summary`

## 7. 调试与日志文件

### `logs/*.log.jsonl`

作用：

- 阶段级详细日志
- 每行一条 JSON 事件，适合程序化排查

常见文件：

- `logs/pipeline.log.jsonl`
- `logs/extract_text.log.jsonl`
- `logs/extract_multimodal.log.jsonl`
- `logs/post_parse.log.jsonl`
- `logs/knowledge.log.jsonl`
- `logs/verify.log.jsonl`

### `logs/*.summary.json`

作用：

- 对应阶段的轻量摘要
- 比 `.log.jsonl` 更适合人工快速看状态

## 8. 如果只保留一小部分文件，建议保留哪些

如果后续要压缩归档，但还想保留主要价值，建议至少保留：

- `batch_pipeline_report.json`
- `<paper_id>/run_manifest.json`
- `<paper_id>/final/text_extraction.json`
- `<paper_id>/final/text_knowledge.md`
- `<paper_id>/final/multimodal_figures.json`
- `<paper_id>/verify/text_extraction_fixed.json`
- `<paper_id>/verify/verify_report.json`

如果还需要可追溯性，额外保留：

- `<paper_id>/preprocess/cleaned_input.md`
- `<paper_id>/extraction_postprocess/field_evidence.json`
- `<paper_id>/normalized/unit_normalization_report.json`
- `<paper_id>/logs/*.summary.json`

## 9. 实际使用建议

面向不同目标，建议看的入口如下：

- 想拿结构化结果做下游处理：优先看 `verify/text_extraction_fixed.json`
- 想快速读懂论文：优先看 `final/text_knowledge.md`
- 想看图像结果：优先看 `final/multimodal_figures.json`
- 想查字段证据来源：优先看 `extraction_postprocess/field_evidence.json`
- 想查 verify 到底改了什么：优先看 `verify/verify_report.json` 和 `verify/patches/*.patch.json`
- 想判断一整批有没有跑稳：优先看 `batch_pipeline_report.json` 和各篇的 `logs/*.summary.json`
