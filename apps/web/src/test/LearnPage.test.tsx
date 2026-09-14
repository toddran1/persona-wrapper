import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getBillingCatalog: vi.fn()
}));

vi.mock("../lib/authClient.js", () => ({
  authClient: { getSession: mocks.getSession }
}));

vi.mock("../lib/api.js", () => ({
  api: { getBillingCatalog: mocks.getBillingCatalog }
}));

import { GUIDES, LearnPage } from "../components/LearnPage.js";

function renderLearn(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/learn/:slug" element={<LearnPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("LearnPage", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ADSENSE_BRONZE_AD_SLOT", "6015183891");
    mocks.getSession.mockResolvedValue({ data: null, error: null });
    mocks.getBillingCatalog.mockResolvedValue({ currentPlanId: "bronze" });
    Object.assign(window, { adsbygoogle: [] });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "adsbygoogle");
    Reflect.deleteProperty(window, "googlefc");
    document.getElementById("forthebaddiez-adsense-loader")?.remove();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("publishes a navigable index without an ad slot", () => {
    renderLearn("/learn");
    expect(screen.getByRole("heading", { name: /Better prompts/i })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(GUIDES.length);
    expect(screen.queryByRole("complementary", { name: "Advertisement" })).not.toBeInTheDocument();
  });

  it("places one clearly labeled ad after publisher content for a public reader", async () => {
    renderLearn("/learn/better-ai-images");
    expect(screen.getByRole("heading", { level: 1, name: "Directing AI images without losing the persona" })).toBeInTheDocument();
    expect(screen.getByText("Build the scene in layers")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("complementary", { name: "Advertisement" })).toBeInTheDocument());
    expect(document.querySelectorAll("ins.adsbygoogle")).toHaveLength(1);
  });

  it("does not request an article ad for a signed-in paid member", async () => {
    mocks.getSession.mockResolvedValue({ data: { user: { id: "paid-user" } }, error: null });
    mocks.getBillingCatalog.mockResolvedValue({ currentPlanId: "silver" });
    renderLearn("/learn/privacy-memory-location");
    await waitFor(() => expect(mocks.getBillingCatalog).toHaveBeenCalledOnce());
    expect(screen.queryByRole("complementary", { name: "Advertisement" })).not.toBeInTheDocument();
  });
});
