import { yuan } from '../format.js';

/** 每日趋势柱状图（成功制作数），悬停显示数值 */
export function TrendBars({ trend, days }) {
  if (!trend?.length) return <p className="small muted">当前时间范围暂无制作</p>;
  const map = Object.fromEntries(trend.map((d) => [d.date, d]));
  const n = days > 0 ? days : Math.min(60, trend.length);
  const end = new Date();
  const dates = [];
  if (days > 0) {
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(end.getTime() - i * 86400000);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
  } else dates.push(...trend.slice(-n).map((d) => d.date));
  const max = Math.max(1, ...dates.map((d) => map[d]?.success || 0));
  return (
    <div>
      <div className="bar-chart" role="img" aria-label="每日成功制作趋势">
        {dates.map((d) => {
          const v = map[d]?.success || 0;
          return <div key={d} className="bar" style={{ height: `${Math.max(2, (v / max) * 100)}%`, opacity: v ? 1 : 0.25 }} data-tip={`${d.slice(5)}：${v} 次 · ${yuan(map[d]?.revenue || 0)}`} />;
        })}
      </div>
      <div className="row-between small muted" style={{ marginTop: 4 }}>
        <span>{dates[0]?.slice(5)}</span>
        <span>{dates[dates.length - 1]?.slice(5)}</span>
      </div>
    </div>
  );
}
