import type { ChartSeries } from "@persona/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type ChartBlockProps = {
  title: string;
  chartType: "bar" | "line" | "pie";
  series: ChartSeries[];
};

const CHART_COLORS = ["#d6b55e", "#9b72f2", "#e06f9f", "#69c4b1", "#ef8d5b", "#7899e8"];

export function ChartBlock({ title, chartType, series }: ChartBlockProps) {
  const commonAxis = {
    tick: { fill: "rgba(247, 241, 255, 0.68)", fontSize: 12 },
    axisLine: { stroke: "rgba(255,255,255,0.12)" },
    tickLine: false
  } as const;

  return (
    <figure className="chart-card" aria-label={`${title}, ${chartType} chart`}>
      <figcaption>
        <div className="output-label">{chartType} chart</div>
        <h3>{title}</h3>
      </figcaption>
      <div className="chart-visual">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "pie" ? (
            <PieChart>
              <Pie data={series} dataKey="value" nameKey="label" innerRadius="40%" outerRadius="78%" paddingAngle={2}>
                {series.map((point, index) => <Cell key={point.label} fill={CHART_COLORS[index % CHART_COLORS.length] ?? "#d6b55e"} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#171020", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12 }} />
            </PieChart>
          ) : chartType === "line" ? (
            <LineChart data={series} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="label" {...commonAxis} />
              <YAxis {...commonAxis} width={42} />
              <Tooltip contentStyle={{ background: "#171020", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12 }} />
              <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0] ?? "#d6b55e"} strokeWidth={3} dot={{ fill: CHART_COLORS[1] ?? "#9b72f2", r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          ) : (
            <BarChart data={series} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="label" {...commonAxis} />
              <YAxis {...commonAxis} width={42} />
              <Tooltip contentStyle={{ background: "#171020", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12 }} />
              <Bar dataKey="value" radius={[8, 8, 2, 2]}>
                {series.map((point, index) => <Cell key={point.label} fill={CHART_COLORS[index % CHART_COLORS.length] ?? "#d6b55e"} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
