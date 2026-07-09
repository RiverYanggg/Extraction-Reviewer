// Metrics modal — live P/R/F1 preview.
import { el } from "./dom.js";
import { store } from "./store.js";
import { api } from "./api.js";
import { SECTION_LABELS, esc } from "./util.js";

export async function openMetrics() {
  await store.flush();
  el.metricsModal.classList.remove("hidden");
  el.metricsBody.innerHTML = `<div class="inspector-empty">计算中…</div>`;
  let m;
  try {
    m = await api.metrics(store.paperId);
  } catch (e) {
    el.metricsBody.innerHTML = `<div class="inspector-empty">计算失败：${esc(e.message)}</div>`;
    return;
  }
  const ov = m.overall, cov = m.coverage;
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const rows = Object.entries(m.per_section).map(([s, v]) =>
    `<tr><td>${esc(SECTION_LABELS[s] || s)}</td><td>${pct(v.precision)}</td><td>${pct(v.recall)}</td>
     <td>${pct(v.f1)}</td><td>${v.tp}</td><td>${v.fp}</td><td>${v.fn}</td></tr>`).join("");
  el.metricsBody.innerHTML = `
    <div class="metric-headline">
      <div class="metric-card"><div class="mv">${pct(ov.precision)}</div><div class="ml">Precision</div></div>
      <div class="metric-card"><div class="mv">${pct(ov.recall)}</div><div class="ml">Recall</div></div>
      <div class="metric-card"><div class="mv">${pct(ov.f1)}</div><div class="ml">F1</div></div>
    </div>
    <div class="metric-cov">
      TP=${ov.tp} · FP=${ov.fp} · FN=${ov.fn} · TN=${cov.true_negatives} ｜
      已审 ${cov.reviewed_slots}/${cov.total_slots} (${cov.reviewed_pct}%)，待定 ${cov.pending_slots}，补充 ${cov.added_fields}
    </div>
    <p style="font-size:12px;color:var(--ink-soft);margin:0 0 10px">
      定义：TP=已确认非空，FP=已修改+冲突，FN=补齐的空槽+已补充，TN=确认为空（不计入 P/R）；待复核/未处理不计入。
      pred=原始抽取，golden=人工标注。<b>预定义 null 字段参与召回</b>。
    </p>
    <table class="metrics-tbl">
      <thead><tr><th>section</th><th>P</th><th>R</th><th>F1</th><th>TP</th><th>FP</th><th>FN</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7">暂无已审字段</td></tr>`}</tbody>
    </table>
    <p style="font-size:11.5px;color:var(--ink-faint);margin-top:10px">导出时生成 <code>evaluation_metrics.json</code>（同一算法）。</p>`;
}
