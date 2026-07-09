import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImageBlock } from "../components/output/ImageBlock";

const imageUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("ImageBlock", () => {
  it("renders chat-sized image actions and opens a full-size viewer from the image", async () => {
    const user = userEvent.setup();
    render(
      <ImageBlock
        url={imageUrl}
        alt="Generated Knuckles portrait"
        prompt="Knuckles in a black suit and sunglasses"
        mimeType="image/png"
        metadata={{ id: "ig_123456789abcdef" }}
      />
    );

    const downloadButtons = screen.getAllByLabelText("Download image");
    expect(downloadButtons[0]).toHaveAttribute("type", "button");
    expect(screen.getByLabelText("More image actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("More image actions"));
    expect(screen.getByRole("menuitem", { name: "Open original" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy prompt" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("Open image full size"));
    expect(screen.getByRole("dialog", { name: "Full size image viewer" })).toBeInTheDocument();
    expect(screen.getAllByAltText("Generated Knuckles portrait")).toHaveLength(2);
  });

  it("opens the full-size viewer from the edit button", async () => {
    const user = userEvent.setup();
    render(<ImageBlock url={imageUrl} alt="Generated image" prompt="Prompt text" />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Full size image viewer" })).toBeInTheDocument();
  });

  it("closes the full-size viewer from the close button", async () => {
    const user = userEvent.setup();
    render(<ImageBlock url={imageUrl} alt="Generated image" prompt="Prompt text" />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Full size image viewer" })).toBeInTheDocument();

    const closeButton = screen.getAllByRole("button", { name: "Close full size image" })[0];
    expect(closeButton).toBeDefined();
    await user.click(closeButton as HTMLElement);
    expect(screen.queryByRole("dialog", { name: "Full size image viewer" })).not.toBeInTheDocument();
  });
});
