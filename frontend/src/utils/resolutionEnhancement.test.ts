import { describe, expect, it } from "vitest";

import { applyUnsharpMask, calculateUpscaledSize } from "./resolutionEnhancement";

describe("resolution enhancement", () => {
  it("calculates a scaled output size", () => {
    expect(calculateUpscaledSize(320, 180, 2)).toEqual({ width: 640, height: 360 });
    expect(calculateUpscaledSize(320, 180, 3)).toEqual({ width: 960, height: 540 });
  });

  it("keeps uniform pixels unchanged when sharpening", () => {
    const pixels = new Uint8ClampedArray([
      120, 120, 120, 255, 120, 120, 120, 255, 120, 120, 120, 255,
      120, 120, 120, 255, 120, 120, 120, 255, 120, 120, 120, 255,
      120, 120, 120, 255, 120, 120, 120, 255, 120, 120, 120, 255,
    ]);

    const result = applyUnsharpMask(pixels, 3, 3, 0.75);

    expect(Array.from(result)).toEqual(Array.from(pixels));
  });

  it("increases contrast around edges without changing alpha", () => {
    const pixels = new Uint8ClampedArray([
      20, 20, 20, 255, 20, 20, 20, 255, 220, 220, 220, 255,
      20, 20, 20, 255, 120, 120, 120, 128, 220, 220, 220, 255,
      20, 20, 20, 255, 20, 20, 20, 255, 220, 220, 220, 255,
    ]);

    const result = applyUnsharpMask(pixels, 3, 3, 1);
    const centerOffset = (1 + 1 * 3) * 4;

    expect(result[centerOffset]).toBeGreaterThan(120);
    expect(result[centerOffset + 3]).toBe(128);
  });
});
