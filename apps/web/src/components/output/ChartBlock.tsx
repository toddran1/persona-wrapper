import type { ChartSeries } from "@persona/shared";

type ChartBlockProps = {
  title: string;
  chartType: string;
  series: ChartSeries[];
};

export function ChartBlock({ title, chartType, series }: ChartBlockProps) {
  return (
    <div className="chart-card">
      <div className="output-label">{chartType} chart</div>
      <h3>{title}</h3>
      <div className="chart-stack">
        {series.map((point) => (
          <div key={point.label} className="chart-row">
            <div className="chart-meta">
              <span>{point.label}</span>
              <strong>{point.value}</strong>
            </div>
            <div className="chart-bar-shell">
              <div className="chart-bar-fill" style={{ width: `${Math.min(point.value, 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

