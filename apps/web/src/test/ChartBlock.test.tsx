import { render, screen } from "@testing-library/react";
import type { ContentBlock } from "@persona/shared";
import { describe, expect, it } from "vitest";
import { ChartBlock } from "../components/output/ChartBlock";

describe("ChartBlock", () => {
  it("renders a rich multi-series chart with an accessible data fallback", () => {
    const output: Extract<ContentBlock, { type: "chart" }> = {
      type: "chart",
      version: 1,
      title: "Quarterly revenue",
      chartType: "bar",
      categories: ["Q1", "Q2"],
      datasets: [
        { id: "current", label: "Current year", values: [125000, 151000] },
        { id: "prior", label: "Prior year", values: [110000, 132000] }
      ],
      xAxis: { label: "Quarter", dataType: "category" },
      yAxis: { label: "Revenue", format: "currency", currency: "USD", unit: null },
      summary: "Current-year revenue increased from Q1 to Q2.",
      sourceNote: "Internal finance data",
      series: []
    };

    render(<ChartBlock output={output} />);

    expect(screen.getByRole("figure", { name: /Quarterly revenue, bar chart/i })).toBeInTheDocument();
    expect(screen.getByText("Current-year revenue increased from Q1 to Q2.")).toBeInTheDocument();
    expect(screen.getByText("View chart data")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Current year" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Q2" })).toBeInTheDocument();
    expect(screen.getByText("$151,000.00")).toBeInTheDocument();
    expect(screen.getByText("Internal finance data")).toBeInTheDocument();
  });

  it("shows an explicit fallback for an imported chart with no plottable data", () => {
    const output: Extract<ContentBlock, { type: "chart" }> = {
      type: "chart",
      version: 1,
      title: "Empty scatter",
      chartType: "scatter",
      categories: [],
      datasets: [{ id: "points", label: "Points", values: [] }],
      xAxis: { label: "X", dataType: "number" },
      yAxis: { label: "Y", format: "number", currency: null, unit: null },
      summary: "No measurements were available.",
      sourceNote: null,
      series: []
    };

    render(<ChartBlock output={output} />);

    expect(screen.getByText("No chart data available.")).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: /Empty scatter, scatter chart/i })).toBeInTheDocument();
  });
});
