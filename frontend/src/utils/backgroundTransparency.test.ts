import { describe, expect, it } from "vitest";

import { applyTransparentBackground } from "./backgroundTransparency";

describe("background transparency", () => {
  it("makes edge-connected background pixels transparent", () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 20, 30, 40, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);

    const result = applyTransparentBackground(pixels, 3, 3, 12);

    expect(alphaAt(result, 0, 0, 3)).toBe(0);
    expect(alphaAt(result, 2, 2, 3)).toBe(0);
    expect(alphaAt(result, 1, 1, 3)).toBe(255);
  });

  it("keeps enclosed matching-color holes opaque", () => {
    const white = [255, 255, 255, 255];
    const dark = [20, 30, 40, 255];
    const pixels = new Uint8ClampedArray([
      ...white, ...white, ...white, ...white, ...white,
      ...white, ...dark, ...dark, ...dark, ...white,
      ...white, ...dark, ...white, ...dark, ...white,
      ...white, ...dark, ...dark, ...dark, ...white,
      ...white, ...white, ...white, ...white, ...white,
    ]);

    const result = applyTransparentBackground(pixels, 5, 5, 12);

    expect(alphaAt(result, 0, 0, 5)).toBe(0);
    expect(alphaAt(result, 2, 2, 5)).toBe(255);
    expect(alphaAt(result, 2, 1, 5)).toBe(255);
  });

  it("uses tolerance for near-background colors", () => {
    const pixels = new Uint8ClampedArray([
      250, 250, 250, 255, 245, 245, 245, 255, 250, 250, 250, 255,
      250, 250, 250, 255, 10, 10, 10, 255, 250, 250, 250, 255,
      250, 250, 250, 255, 250, 250, 250, 255, 250, 250, 250, 255,
    ]);

    const result = applyTransparentBackground(pixels, 3, 3, 12);

    expect(alphaAt(result, 0, 0, 3)).toBe(0);
    expect(alphaAt(result, 1, 0, 3)).toBe(0);
    expect(alphaAt(result, 1, 1, 3)).toBe(255);
  });
});

function alphaAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number {
  return pixels[(x + y * width) * 4 + 3];
}
