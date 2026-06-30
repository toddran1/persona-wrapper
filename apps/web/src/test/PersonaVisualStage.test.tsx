import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonaVisualStage } from "../components/PersonaVisualStage";

function activeVideo(container: HTMLElement): HTMLVideoElement {
  const video = container.querySelector('video[data-active="true"]');
  expect(video).toBeInstanceOf(HTMLVideoElement);
  return video as HTMLVideoElement;
}

describe("PersonaVisualStage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders muted loop videos for persona states", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const { container } = render(<PersonaVisualStage state="idle" personaName="LaRae" />);
    const video = activeVideo(container);

    expect(video).toHaveAttribute("src", "/personas/larae/videos/loops/larae-video-idle-10s-1st.mp4");
    expect(video.loop).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
  });

  it("plays a transition before settling into the requested loop", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const { container, rerender } = render(<PersonaVisualStage state="idle" personaName="LaRae" />);

    rerender(<PersonaVisualStage state="thinking" personaName="LaRae" />);
    let video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/transitions/larae-video-idle-to-thinking-1s-1st.mp4");
    expect(video.loop).toBe(false);

    fireEvent.ended(video);
    video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/loops/larae-video-thinking-10s-1st.mp4");
    expect(video.loop).toBe(false);

    rerender(<PersonaVisualStage state="speaking" personaName="LaRae" />);
    video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/transitions/larae-video-thinking-to-talking-1s-1st.mp4");
  });

  it("chains transitions when the next state arrives before the current transition ends", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const { container, rerender } = render(<PersonaVisualStage state="idle" personaName="LaRae" />);

    rerender(<PersonaVisualStage state="thinking" personaName="LaRae" />);
    let video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/transitions/larae-video-idle-to-thinking-1s-1st.mp4");

    rerender(<PersonaVisualStage state="speaking" personaName="LaRae" />);
    video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/transitions/larae-video-thinking-to-talking-1s-1st.mp4");

    fireEvent.ended(video);
    video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/loops/larae-video-talking-10s-1st.mp4");
    expect(video.loop).toBe(false);
  });

  it("picks another random clip from the same state after a state video ends", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const { container } = render(<PersonaVisualStage state="idle" personaName="LaRae" />);
    let video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/loops/larae-video-idle-10s-1st.mp4");

    fireEvent.ended(video);
    video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/loops/larae-video-idle-10s-2nd.mp4");
  });

  it("skips a failed video source without crashing the visual stage", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const { container } = render(<PersonaVisualStage state="idle" personaName="LaRae" />);
    let video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/loops/larae-video-idle-10s-1st.mp4");

    fireEvent.error(video);
    video = activeVideo(container);
    expect(video).toHaveAttribute("src", "/personas/larae/videos/loops/larae-video-idle-10s-2nd.mp4");
  });
});
