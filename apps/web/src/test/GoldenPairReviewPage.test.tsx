import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoldenPairReviewPage } from "../components/GoldenPairReviewPage.js";

const { getStyleTransferReview } = vi.hoisted(() => ({
  getStyleTransferReview: vi.fn()
}));

vi.mock("../lib/api.js", () => ({
  api: {
    getStyleTransferReview,
    updateStyleTransferReviewRecord: vi.fn(),
    createStyleTransferReviewRecord: vi.fn(),
    deleteStyleTransferReviewRecord: vi.fn(),
    promoteRejectedStylePair: vi.fn()
  }
}));

const personas = [
  {
    id: "larae",
    name: "LaRae the Baddest",
    shortName: "LaRae",
    avatarUrl: "/personas/larae.png",
    datasetKey: "larae",
    styleReferenceEnabled: true
  },
  {
    id: "bambam",
    name: "Bam Bam",
    shortName: "Bam",
    avatarUrl: "/personas/bambam.png",
    datasetKey: "bambam",
    styleReferenceEnabled: false
  }
];

function reviewData(personaId: "larae" | "bambam") {
  const persona = personas.find((candidate) => candidate.id === personaId)!;
  const root = personaId === "larae" ? "/datasets" : `/personas/${persona.datasetKey}`;
  return {
    persona,
    personas,
    evals: [],
    goldenPairs: [],
    syntheticPairs: [],
    heuristicRejections: [],
    paths: {
      evals: `${root}/evals.jsonl`,
      goldenPairs: `${root}/golden.jsonl`,
      syntheticPairs: `${root}/synthetic.jsonl`,
      heuristicRejections: `${root}/rejections.jsonl`
    }
  };
}

describe("GoldenPairReviewPage", () => {
  beforeEach(() => {
    getStyleTransferReview.mockReset();
    getStyleTransferReview.mockImplementation((personaId?: string) =>
      Promise.resolve(reviewData(personaId === "bambam" ? "bambam" : "larae"))
    );
  });

  it("switches the entire review workspace to the selected persona", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/review?persona=larae"]}>
        <GoldenPairReviewPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Test mode · LaRae")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Bam/ }));

    await waitFor(() => expect(getStyleTransferReview).toHaveBeenLastCalledWith("bambam"));
    expect(await screen.findByText("Test mode · Bam")).toBeInTheDocument();
    expect(screen.getByText("/personas/bambam/evals.jsonl")).toBeInTheDocument();
  });
});
