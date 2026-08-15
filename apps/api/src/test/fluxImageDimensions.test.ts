import { afterEach, describe, expect, it } from "vitest";
import { getPersonaById } from "../personas/index.js";
import { PersonaEngine } from "../services/personaEngine.js";
import { fluxImageDimensions } from "../providers/image/fluxImageDimensions.js";
import { env } from "../config/env.js";

const originalImageSize = env.OPENAI_IMAGE_SIZE;

afterEach(() => {
  env.OPENAI_IMAGE_SIZE = originalImageSize;
});

function inputFor(message: string) {
  const persona = getPersonaById("larae");
  if (!persona) throw new Error("LaRae persona not found");
  return new PersonaEngine().prepareInput(persona, {
    personaId: "larae",
    provider: "openai",
    message,
    audio: false,
    testMode: false,
    history: []
  });
}

describe("fluxImageDimensions", () => {
  it("maps explicit aspect-ratio and orientation hints in the message", () => {
    env.OPENAI_IMAGE_SIZE = "auto";
    expect(fluxImageDimensions(inputFor("make it 16:9"))).toEqual({ width: 1536, height: 864 });
    expect(fluxImageDimensions(inputFor("make it 9:16"))).toEqual({ width: 864, height: 1536 });
    expect(fluxImageDimensions(inputFor("make it 4:3"))).toEqual({ width: 1280, height: 960 });
    expect(fluxImageDimensions(inputFor("a phone wallpaper of her"))).toEqual({ width: 1024, height: 1536 });
    expect(fluxImageDimensions(inputFor("a wide banner of the rooftop"))).toEqual({ width: 1536, height: 1024 });
  });

  it("maps the app-wide image size setting when the message has no hint", () => {
    env.OPENAI_IMAGE_SIZE = "1536x1024";
    expect(fluxImageDimensions(inputFor("generate an image of a rooftop party"))).toEqual({ width: 1536, height: 1024 });
    env.OPENAI_IMAGE_SIZE = "1024x1536";
    expect(fluxImageDimensions(inputFor("generate an image of a rooftop party"))).toEqual({ width: 1024, height: 1536 });
    env.OPENAI_IMAGE_SIZE = "1024x1024";
    expect(fluxImageDimensions(inputFor("generate an image of a rooftop party"))).toEqual({ width: 1024, height: 1024 });
  });

  it("does not treat arithmetic or loose prose as dimension hints", () => {
    env.OPENAI_IMAGE_SIZE = "auto";
    expect(fluxImageDimensions(inputFor("what is 4 x 3 = 12?"))).toEqual({
      width: env.BFL_IMAGE_WIDTH,
      height: env.BFL_IMAGE_HEIGHT
    });
    expect(fluxImageDimensions(inputFor("a wide variety of neon styles"))).toEqual({
      width: env.BFL_IMAGE_WIDTH,
      height: env.BFL_IMAGE_HEIGHT
    });
    expect(fluxImageDimensions(inputFor("a wide shot of the rooftop"))).toEqual({ width: 1536, height: 1024 });
  });

  it("falls back to the FLUX defaults on auto", () => {
    env.OPENAI_IMAGE_SIZE = "auto";
    expect(fluxImageDimensions(inputFor("generate an image of a rooftop party")))
      .toEqual({ width: env.BFL_IMAGE_WIDTH, height: env.BFL_IMAGE_HEIGHT });
  });
});
