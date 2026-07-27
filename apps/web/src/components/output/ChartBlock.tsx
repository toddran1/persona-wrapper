import type { ContentBlock } from "@persona/shared";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type ChartOutput = Extract<ContentBlock, { type: "chart" }>;
type NumericDataset = { id: string; label: string; values: Array<number | null> };

const CHART_COLORS = [
  "var(--theme-chart-1, #d6b55e)",
  "var(--theme-chart-2, #9b72f2)",
  "var(--theme-chart-3, #e06f9f)",
  "var(--theme-chart-4, #69c4b1)",
  "var(--theme-chart-5, #ef8d5b)",
  "var(--theme-chart-6, #7899e8)"
];

function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? "#d6b55e";
}

function normalizedCategories(output: ChartOutput): string[] {
  return output.categories.length > 0 ? output.categories : output.series.map((point) => point.label);
}

function normalizedDatasets(output: ChartOutput): NumericDataset[] {
  const datasets = output.datasets.flatMap((dataset) => {
    const values = dataset.values.map((value) => typeof value === "number" ? value : null);
    return values.some((value) => value !== null) ? [{ id: dataset.id, label: dataset.label, values }] : [];
  });
  if (datasets.length > 0) return datasets;
  return output.series.length > 0
    ? [{ id: "value", label: output.yAxis?.label || "Value", values: output.series.map((point) => point.value) }]
    : [];
}

function chartRows(output: ChartOutput): Array<Record<string, string | number | null>> {
  const categories = normalizedCategories(output);
  const datasets = normalizedDatasets(output);
  return categories.map((category, index) => ({
    category,
    ...Object.fromEntries(datasets.map((dataset) => [dataset.id, dataset.values[index] ?? null]))
  }));
}

function formatChartValue(value: number | null, output: ChartOutput): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const format = output.yAxis?.format ?? "number";
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  if (format === "currency" && output.yAxis?.currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: output.yAxis.currency,
        maximumFractionDigits: 2
      }).format(value);
    } catch {
      // Invalid imported currency codes fall back to ordinary numeric formatting.
    }
  }
  const formatted = number.format(value);
  if (format === "percent") return `${formatted}%`;
  if (output.yAxis?.unit) return `${formatted} ${output.yAxis.unit}`;
  return formatted;
}

function ChartDataTable({ output }: { output: ChartOutput }) {
  const categories = normalizedCategories(output);
  const datasets = normalizedDatasets(output);
  if (output.chartType === "scatter") {
    const points = output.datasets.flatMap((dataset) =>
      dataset.values.flatMap((value) =>
        typeof value === "object" && value !== null
          ? [{ dataset: dataset.label, ...value }]
          : []
      )
    );
    return (
      <div className="chart-table-scroll">
        <table>
          <thead><tr><th>Series</th><th>{output.xAxis?.label || "X"}</th><th>{output.yAxis?.label || "Y"}</th><th>Label</th></tr></thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={`${point.dataset}-${point.x}-${point.y}-${index}`}>
                <th scope="row">{point.dataset}</th>
                <td>{point.x}</td>
                <td>{formatChartValue(point.y, output)}</td>
                <td>{point.label ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="chart-table-scroll">
      <table>
        <thead>
          <tr>
            <th>{output.xAxis?.label || "Category"}</th>
            {datasets.map((dataset) => <th key={dataset.id}>{dataset.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => (
            <tr key={`${category}-${index}`}>
              <th scope="row">{category}</th>
              {datasets.map((dataset) => <td key={dataset.id}>{formatChartValue(dataset.values[index] ?? null, output)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartBlock({ output }: { output: ChartOutput }) {
  const categories = normalizedCategories(output);
  const datasets = normalizedDatasets(output);
  const rows = chartRows(output);
  const chartType = output.chartType === "pie" ? "donut" : output.chartType;
  const scatterPointCount = output.datasets.reduce(
    (count, dataset) => count + dataset.values.filter((value) => typeof value === "object" && value !== null).length,
    0
  );
  const donutTotal = (datasets[0]?.values ?? []).reduce<number>(
    (total, value) => total + Math.max(0, value ?? 0),
    0
  );
  const hasVisualData = chartType === "scatter"
    ? scatterPointCount > 0
    : chartType === "donut"
      ? categories.length > 0 && donutTotal > 0
      : categories.length > 0 && datasets.length > 0;
  const commonAxis = {
    tick: { fill: "var(--theme-muted, rgba(247, 241, 255, 0.68))", fontSize: 12 },
    axisLine: { stroke: "rgba(255,255,255,0.12)" },
    tickLine: false
  } as const;
  const tooltip = (
    <Tooltip
      formatter={(value) => formatChartValue(typeof value === "number" ? value : Number(value), output)}
      contentStyle={{
        background: "var(--theme-surface-strong, #171020)",
        border: "1px solid var(--theme-border, rgba(255,255,255,.15))",
        borderRadius: 12,
        color: "var(--theme-text, #fff)"
      }}
    />
  );

  return (
    <figure className="chart-card" aria-label={`${output.title}, ${chartType} chart`}>
      <figcaption>
        <div className="output-label">{chartType} chart</div>
        <h3>{output.title}</h3>
        {output.summary ? <p className="chart-summary">{output.summary}</p> : null}
      </figcaption>
      <div className="chart-visual" aria-hidden="true">
        {hasVisualData ? <ResponsiveContainer width="100%" height="100%">
          {chartType === "donut" ? (
            <PieChart>
              <Pie
                data={categories.map((label, index) => ({
                  label,
                  value: Math.max(0, datasets[0]?.values[index] ?? 0)
                }))}
                dataKey="value"
                nameKey="label"
                innerRadius="40%"
                outerRadius="78%"
                paddingAngle={2}
              >
                {categories.map((label, index) => (
                  <Cell key={`${label}-${index}`} fill={chartColor(index)} />
                ))}
              </Pie>
              {tooltip}
              <Legend />
            </PieChart>
          ) : chartType === "scatter" ? (
            <ScatterChart margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis type="number" dataKey="x" name={output.xAxis?.label || "X"} {...commonAxis} />
              <YAxis type="number" dataKey="y" name={output.yAxis?.label || "Y"} {...commonAxis} width={52} />
              {tooltip}
              <Legend />
              {output.datasets.map((dataset, index) => (
                <Scatter
                  key={dataset.id}
                  name={dataset.label}
                  fill={chartColor(index)}
                  data={dataset.values.filter((value) => typeof value === "object" && value !== null)}
                />
              ))}
            </ScatterChart>
          ) : chartType === "area" ? (
            <AreaChart data={rows} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="category" {...commonAxis} />
              <YAxis {...commonAxis} width={52} />
              {tooltip}
              <Legend />
              {datasets.map((dataset, index) => (
                <Area
                  key={dataset.id}
                  type="monotone"
                  dataKey={dataset.id}
                  name={dataset.label}
                  stroke={chartColor(index)}
                  fill={chartColor(index)}
                  fillOpacity={0.2}
                  connectNulls
                />
              ))}
            </AreaChart>
          ) : chartType === "line" ? (
            <LineChart data={rows} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="category" {...commonAxis} />
              <YAxis {...commonAxis} width={52} />
              {tooltip}
              <Legend />
              {datasets.map((dataset, index) => (
                <Line
                  key={dataset.id}
                  type="monotone"
                  dataKey={dataset.id}
                  name={dataset.label}
                  stroke={chartColor(index)}
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="category" {...commonAxis} />
              <YAxis {...commonAxis} width={52} />
              {tooltip}
              <Legend />
              {datasets.map((dataset, index) => (
                <Bar
                  key={dataset.id}
                  dataKey={dataset.id}
                  name={dataset.label}
                  fill={chartColor(index)}
                  radius={[6, 6, 2, 2]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer> : <p className="chart-empty">No chart data available.</p>}
      </div>
      <details className="chart-data-table">
        <summary>View chart data</summary>
        <ChartDataTable output={output} />
      </details>
      {output.sourceNote ? <p className="chart-source">{output.sourceNote}</p> : null}
    </figure>
  );
}
