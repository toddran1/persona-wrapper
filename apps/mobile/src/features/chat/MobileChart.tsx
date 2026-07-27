import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ContentBlock } from "@persona/shared";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import type { MobileTheme } from "../../theme/personaTheme";

type ChartOutput = Extract<ContentBlock, { type: "chart" }>;
type NumericDataset = { id: string; label: string; values: Array<number | null> };

type MobileChartProps = {
  output: ChartOutput;
  theme: MobileTheme;
};

const CHART_HEIGHT = 236;
const PLOT_TOP = 20;
const PLOT_BOTTOM = 48;
const PLOT_LEFT = 48;
const PLOT_RIGHT = 16;
export const MAX_MOBILE_CHART_POINTS = 60;
export const MAX_MOBILE_DONUT_SLICES = 20;

function categoriesFor(output: ChartOutput): string[] {
  const limit = output.chartType === "donut" || output.chartType === "pie"
    ? MAX_MOBILE_DONUT_SLICES
    : MAX_MOBILE_CHART_POINTS;
  return (output.categories.length > 0 ? output.categories : output.series.map((point) => point.label)).slice(0, limit);
}

function datasetsFor(output: ChartOutput, valueLimit = MAX_MOBILE_CHART_POINTS): NumericDataset[] {
  const datasets = output.datasets.flatMap((dataset) => {
    const values = dataset.values
      .slice(0, valueLimit)
      .map((value) => typeof value === "number" && Number.isFinite(value) ? value : null);
    return values.some((value) => value !== null) ? [{ id: dataset.id, label: dataset.label, values }] : [];
  });
  if (datasets.length > 0) return datasets;
  return output.series.length > 0
    ? [{
        id: "value",
        label: output.yAxis?.label || "Value",
        values: output.series.slice(0, valueLimit).map((point) => point.value)
      }]
    : [];
}

function hasPlottableData(output: ChartOutput): boolean {
  if (output.chartType === "scatter") {
    return output.datasets.some((dataset) =>
      dataset.values.some((value) =>
        typeof value === "object"
        && value !== null
        && Number.isFinite(value.x)
        && Number.isFinite(value.y)
      )
    );
  }

  const categories = categoriesFor(output);
  if (categories.length === 0) return false;

  if (output.chartType === "pie" || output.chartType === "donut") {
    const values = datasetsFor(output, MAX_MOBILE_DONUT_SLICES)[0]?.values ?? [];
    return values
      .slice(0, categories.length)
      .some((value) => typeof value === "number" && value > 0);
  }

  return datasetsFor(output).some((dataset) =>
    dataset.values
      .slice(0, categories.length)
      .some((value) => value !== null)
  );
}

function chartColor(theme: MobileTheme, index: number): string {
  return theme.chartColors.length > 0
    ? (theme.chartColors[index % theme.chartColors.length] ?? theme.accent2)
    : theme.accent2;
}

function chartWidth(pointCount: number): number {
  return Math.max(300, PLOT_LEFT + PLOT_RIGHT + Math.max(pointCount, 1) * 68);
}

function shortLabel(label: string): string {
  return label.length > 11 ? `${label.slice(0, 10)}…` : label;
}

export function formatMobileChartValue(value: number | null, output: ChartOutput): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const format = output.yAxis?.format ?? "number";
  if (format === "currency" && output.yAxis?.currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: output.yAxis.currency,
        maximumFractionDigits: 2
      }).format(value);
    } catch {
      // Imported charts with invalid currency codes fall back to ordinary numbers.
    }
  }
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  if (format === "percent") return `${formatted}%`;
  if (output.yAxis?.unit) return `${formatted} ${output.yAxis.unit}`;
  return formatted;
}

function Legend({ datasets, theme }: { datasets: NumericDataset[]; theme: MobileTheme }) {
  if (datasets.length <= 1) return null;
  return (
    <View style={styles.horizontalLegend}>
      {datasets.map((dataset, index) => (
        <View key={dataset.id} style={styles.legendRow}>
          <View style={[styles.legendSwatch, { backgroundColor: chartColor(theme, index) }]} />
          <Text numberOfLines={1} style={[styles.legendLabel, { color: theme.text }]}>{dataset.label}</Text>
        </View>
      ))}
    </View>
  );
}

function CategoryChart({ output, theme }: MobileChartProps) {
  const categories = categoriesFor(output);
  const datasets = datasetsFor(output);
  const width = chartWidth(categories.length);
  const plotWidth = width - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
  const values = datasets.flatMap((dataset) => dataset.values).filter((value): value is number => value !== null);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(1, ...values);
  const range = Math.max(1, maximum - minimum);
  const yPosition = (value: number) => PLOT_TOP + (maximum - value) / range * plotHeight;
  const zeroY = yPosition(0);
  const slotWidth = plotWidth / Math.max(categories.length, 1);
  const chartType = output.chartType === "pie" ? "donut" : output.chartType;

  return (
    <View>
      <Svg width={width} height={CHART_HEIGHT}>
        {[0, 0.5, 1].map((ratio) => {
          const value = maximum - range * ratio;
          const y = PLOT_TOP + plotHeight * ratio;
          return (
            <G key={ratio}>
              <Line x1={PLOT_LEFT} x2={width - PLOT_RIGHT} y1={y} y2={y} stroke={theme.border} strokeWidth={1} />
              <SvgText x={PLOT_LEFT - 7} y={y + 4} fill={theme.muted} fontSize={9} textAnchor="end">
                {formatMobileChartValue(value, output)}
              </SvgText>
            </G>
          );
        })}
        {categories.map((category, categoryIndex) => (
          <SvgText
            key={`${category}-${categoryIndex}`}
            x={PLOT_LEFT + slotWidth * categoryIndex + slotWidth / 2}
            y={CHART_HEIGHT - 24}
            fill={theme.muted}
            fontSize={9}
            textAnchor="middle"
          >
            {shortLabel(category)}
          </SvgText>
        ))}
        {datasets.map((dataset, datasetIndex) => {
          const color = chartColor(theme, datasetIndex);
          const positions = dataset.values.flatMap((value, categoryIndex) =>
            value === null ? [] : [{
              x: PLOT_LEFT + slotWidth * categoryIndex + slotWidth / 2,
              y: yPosition(value),
              value,
              categoryIndex
            }]
          );
          const linePath = positions.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
          const areaPath = positions.length > 0
            ? `${linePath} L ${positions.at(-1)?.x ?? 0} ${zeroY} L ${positions[0]?.x ?? 0} ${zeroY} Z`
            : "";

          if (chartType === "bar") {
            const groupWidth = Math.min(slotWidth * 0.74, 50);
            const barWidth = Math.max(3, groupWidth / Math.max(datasets.length, 1));
            return (
              <G key={dataset.id}>
                {positions.map((point) => {
                  const x = point.x - groupWidth / 2 + datasetIndex * barWidth;
                  const y = Math.min(point.y, zeroY);
                  return (
                    <Rect
                      key={`${dataset.id}-${point.categoryIndex}`}
                      x={x}
                      y={y}
                      width={Math.max(2, barWidth - 2)}
                      height={Math.max(1, Math.abs(zeroY - point.y))}
                      rx={3}
                      fill={color}
                    />
                  );
                })}
              </G>
            );
          }

          return (
            <G key={dataset.id}>
              {chartType === "area" && areaPath ? <Path d={areaPath} fill={color} fillOpacity={0.18} /> : null}
              {linePath ? <Path d={linePath} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" /> : null}
              {positions.map((point) => (
                <Circle
                  key={`${dataset.id}-${point.categoryIndex}`}
                  cx={point.x}
                  cy={point.y}
                  r={4}
                  fill={color}
                  stroke={theme.text}
                  strokeWidth={1}
                />
              ))}
            </G>
          );
        })}
      </Svg>
      <Legend datasets={datasets} theme={theme} />
    </View>
  );
}

function ScatterChartView({ output, theme }: MobileChartProps) {
  const width = 340;
  const plotWidth = width - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
  let remainingPoints = MAX_MOBILE_CHART_POINTS;
  const datasets = output.datasets.map((dataset) => {
    const points = dataset.values
      .flatMap((value) => typeof value === "object" && value !== null ? [value] : [])
      .slice(0, remainingPoints);
    remainingPoints -= points.length;
    return { id: dataset.id, label: dataset.label, points };
  }).filter((dataset) => dataset.points.length > 0);
  const points = datasets.flatMap((dataset) => dataset.points);
  if (points.length === 0) {
    return <Text style={[styles.empty, { color: theme.muted }]}>No scatter points available.</Text>;
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const xRange = Math.max(1, maxX - minX);
  const yRange = Math.max(1, maxY - minY);

  return (
    <View>
      <Svg width={width} height={CHART_HEIGHT}>
        {[0, 0.5, 1].map((ratio) => {
          const y = PLOT_TOP + plotHeight * ratio;
          return (
            <G key={ratio}>
              <Line x1={PLOT_LEFT} x2={width - PLOT_RIGHT} y1={y} y2={y} stroke={theme.border} strokeWidth={1} />
              <SvgText x={PLOT_LEFT - 7} y={y + 4} fill={theme.muted} fontSize={9} textAnchor="end">
                {formatMobileChartValue(maxY - yRange * ratio, output)}
              </SvgText>
            </G>
          );
        })}
        {datasets.map((dataset, datasetIndex) => {
          const color = chartColor(theme, datasetIndex);
          return dataset.points.map((point, pointIndex) => (
            <Circle
              key={`${dataset.id}-${pointIndex}`}
              cx={PLOT_LEFT + (point.x - minX) / xRange * plotWidth}
              cy={PLOT_TOP + (maxY - point.y) / yRange * plotHeight}
              r={5}
              fill={color}
              stroke={theme.text}
              strokeWidth={1}
            />
          ));
        })}
        <SvgText x={PLOT_LEFT} y={CHART_HEIGHT - 22} fill={theme.muted} fontSize={9}>{minX}</SvgText>
        <SvgText x={width - PLOT_RIGHT} y={CHART_HEIGHT - 22} fill={theme.muted} fontSize={9} textAnchor="end">{maxX}</SvgText>
      </Svg>
      <Legend datasets={datasets.map((dataset) => ({ ...dataset, values: [] }))} theme={theme} />
    </View>
  );
}

function DonutChart({ output, theme }: MobileChartProps) {
  const categories = categoriesFor(output);
  const dataset = datasetsFor(output, MAX_MOBILE_DONUT_SLICES)[0];
  const values = dataset?.values ?? [];
  const size = 204;
  const center = size / 2;
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  const total = values.reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0);
  let offset = 0;

  return (
    <View style={styles.pieLayout}>
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={radius} fill="none" stroke={theme.border} strokeWidth={34} />
        {total > 0 ? categories.map((category, index) => {
          const value = Math.max(0, values[index] ?? 0);
          const length = value / total * circumference;
          const dashOffset = -offset;
          offset += length;
          return (
            <Circle
              key={`${category}-${index}`}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={chartColor(theme, index)}
              strokeWidth={34}
              strokeDasharray={`${length} ${Math.max(0, circumference - length)}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              rotation={-90}
              origin={`${center}, ${center}`}
            />
          );
        }) : null}
        <SvgText x={center} y={center - 2} fill={theme.text} fontSize={15} fontWeight="800" textAnchor="middle">Total</SvgText>
        <SvgText x={center} y={center + 19} fill={theme.muted} fontSize={12} textAnchor="middle">
          {formatMobileChartValue(total, output)}
        </SvgText>
      </Svg>
      <View style={styles.legend}>
        {categories.map((category, index) => (
          <View key={`${category}-${index}`} style={styles.legendRow}>
            <View style={[styles.legendSwatch, { backgroundColor: chartColor(theme, index) }]} />
            <Text numberOfLines={1} style={[styles.legendLabel, { color: theme.text }]}>{category}</Text>
            <Text style={[styles.legendValue, { color: theme.muted }]}>{formatMobileChartValue(values[index] ?? null, output)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MobileChartView({ output, theme }: MobileChartProps) {
  const hasData = useMemo(
    () => hasPlottableData(output),
    [output]
  );
  if (!hasData) {
    return <Text style={[styles.empty, { color: theme.muted }]}>No chart data available.</Text>;
  }
  if (output.chartType === "pie" || output.chartType === "donut") {
    return <DonutChart output={output} theme={theme} />;
  }
  if (output.chartType === "scatter") {
    return <ScatterChartView output={output} theme={theme} />;
  }
  return <CategoryChart output={output} theme={theme} />;
}

export const MobileChart = memo(MobileChartView);

const styles = StyleSheet.create({
  empty: {
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 28
  },
  horizontalLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: PLOT_LEFT,
    paddingTop: 2
  },
  legend: {
    gap: 8,
    minWidth: 150,
    paddingRight: 8
  },
  legendLabel: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700"
  },
  legendRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7
  },
  legendSwatch: {
    borderRadius: 999,
    height: 10,
    width: 10
  },
  legendValue: {
    fontSize: 12,
    fontVariant: ["tabular-nums"]
  },
  pieLayout: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: CHART_HEIGHT,
    minWidth: 370
  }
});
