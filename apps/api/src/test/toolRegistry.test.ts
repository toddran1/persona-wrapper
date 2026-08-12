import { describe, expect, it } from "vitest";
import { executeApplicationTool, getToolsByNames } from "../providers/tools/toolRegistry.js";

describe("application tool registry", () => {
  it("registers render_chart as a strict application-owned function", () => {
    const tool = getToolsByNames(["render_chart"])[0];

    expect(tool).toBeDefined();
    expect(tool?.owner).toBe("application");
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining(["chartType", "categories", "datasets", "xAxis", "yAxis"])
    });
  });

  it("omits disabled application tools from the provider-facing registry", () => {
    const tools = getToolsByNames(["generate_artifact", "places_search"]);

    expect(tools.map((tool) => tool.name)).toEqual(["generate_artifact"]);
    for (const tool of tools) {
      expect(tool.owner).toBe("application");
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: expect.any(Array)
      });
    }
  });

  it("returns a rich chart block while preserving the legacy series fallback", async () => {
    const result = await executeApplicationTool("render_chart", {
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
      sourceNote: "Example fixture"
    });

    expect(result).toMatchObject({
      type: "chart",
      chartType: "bar",
      categories: ["Q1", "Q2"],
      series: [
        { label: "Q1", value: 125000 },
        { label: "Q2", value: 151000 }
      ]
    });
  });

  it("rejects category and dataset length mismatches", async () => {
    await expect(executeApplicationTool("render_chart", {
      version: 1,
      title: "Broken chart",
      chartType: "line",
      categories: ["Q1", "Q2"],
      datasets: [{ id: "value", label: "Value", values: [1] }],
      xAxis: { label: "Quarter", dataType: "category" },
      yAxis: { label: "Value", format: "number", currency: null, unit: null },
      summary: "This should fail validation.",
      sourceNote: null
    })).rejects.toThrow("Dataset values must match the number of categories");
  });

  it("requires x/y point objects for scatter charts", async () => {
    await expect(executeApplicationTool("render_chart", {
      version: 1,
      title: "Broken scatter",
      chartType: "scatter",
      categories: [],
      datasets: [{ id: "value", label: "Value", values: [1, 2] }],
      xAxis: { label: "X", dataType: "number" },
      yAxis: { label: "Y", format: "number", currency: null, unit: null },
      summary: "This should fail validation.",
      sourceNote: null
    })).rejects.toThrow("Scatter chart datasets must contain x/y point objects");
  });

  it("rejects invalid donut values instead of sending inconsistent charts to clients", async () => {
    await expect(executeApplicationTool("render_chart", {
      version: 1,
      title: "Broken donut",
      chartType: "donut",
      categories: ["A", "B"],
      datasets: [{ id: "value", label: "Value", values: [10, -2] }],
      xAxis: { label: "Category", dataType: "category" },
      yAxis: { label: "Share", format: "percent", currency: null, unit: null },
      summary: "This should fail validation.",
      sourceNote: null
    })).rejects.toThrow("Donut chart values must be non-negative numbers");
  });

  it("requires matching axis metadata for currency and duration formats", async () => {
    await expect(executeApplicationTool("render_chart", {
      version: 1,
      title: "Revenue",
      chartType: "bar",
      categories: ["Q1"],
      datasets: [{ id: "value", label: "Value", values: [100] }],
      xAxis: { label: "Quarter", dataType: "category" },
      yAxis: { label: "Revenue", format: "currency", currency: null, unit: null },
      summary: "This should fail validation.",
      sourceNote: null
    })).rejects.toThrow("Currency charts require a three-letter currency code");
  });
});
