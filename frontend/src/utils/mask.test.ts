import { describe, expect, it } from "vitest";

import {
  applyBrushLine,
  applyRectangle,
  cloneMask,
  createBlankMask,
  hasPaintedPixels,
  maskFromRgbaPixels,
  maskToBlackWhiteRgba,
  mapClientPointToImagePoint,
  mergeMasks,
} from "./mask";

describe("mask operations", () => {
  it("maps viewport pointer coordinates into source image coordinates", () => {
    const point = mapClientPointToImagePoint(
      150,
      90,
      { left: 100, top: 50, width: 200, height: 100 },
      1000,
      500,
    );

    expect(point).toEqual({ x: 250, y: 200 });
  });

  it("clamps mapped coordinates to the image bounds", () => {
    const point = mapClientPointToImagePoint(
      999,
      -50,
      { left: 100, top: 50, width: 200, height: 100 },
      1000,
      500,
    );

    expect(point).toEqual({ x: 999, y: 0 });
  });

  it("reports blank and painted masks", () => {
    const mask = createBlankMask(4, 4);

    expect(hasPaintedPixels(mask)).toBe(false);

    applyRectangle(mask, { x: 1, y: 1 }, { x: 2, y: 2 }, "paint");

    expect(hasPaintedPixels(mask)).toBe(true);
  });

  it("paints and erases rectangular regions inclusively", () => {
    const mask = createBlankMask(4, 4);

    applyRectangle(mask, { x: 1, y: 1 }, { x: 2, y: 2 }, "paint");

    expect(mask.alpha[1 + 1 * 4]).toBe(255);
    expect(mask.alpha[2 + 2 * 4]).toBe(255);
    expect(mask.alpha[0]).toBe(0);

    applyRectangle(mask, { x: 2, y: 2 }, { x: 1, y: 1 }, "erase");

    expect(hasPaintedPixels(mask)).toBe(false);
  });

  it("paints brush strokes along a line and supports erasing", () => {
    const mask = createBlankMask(8, 4);

    applyBrushLine(mask, { x: 1, y: 1 }, { x: 6, y: 1 }, 1, "paint");

    expect(mask.alpha[1 + 1 * 8]).toBe(255);
    expect(mask.alpha[6 + 1 * 8]).toBe(255);
    expect(mask.alpha[4 + 1 * 8]).toBe(255);

    applyBrushLine(mask, { x: 1, y: 1 }, { x: 6, y: 1 }, 1, "erase");

    expect(hasPaintedPixels(mask)).toBe(false);
  });

  it("clones masks without sharing pixel storage", () => {
    const mask = createBlankMask(2, 2);
    const cloned = cloneMask(mask);

    applyRectangle(cloned, { x: 0, y: 0 }, { x: 0, y: 0 }, "paint");

    expect(cloned.alpha[0]).toBe(255);
    expect(mask.alpha[0]).toBe(0);
  });

  it("converts alpha masks to opaque black and white RGBA pixels", () => {
    const mask = createBlankMask(2, 1);
    applyRectangle(mask, { x: 1, y: 0 }, { x: 1, y: 0 }, "paint");

    expect(Array.from(maskToBlackWhiteRgba(mask))).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
  });

  it("converts a plugin RGBA response into a binary mask", () => {
    const mask = maskFromRgbaPixels(
      new Uint8ClampedArray([
        255, 203, 0, 0,
        255, 203, 0, 186,
      ]),
      2,
      1,
    );

    expect(Array.from(mask.alpha)).toEqual([0, 255]);
  });

  it("merges smart selections without mutating the current mask", () => {
    const current = createBlankMask(2, 1);
    current.alpha[0] = 255;
    const incoming = createBlankMask(2, 1);
    incoming.alpha[1] = 255;

    const merged = mergeMasks(current, incoming);

    expect(Array.from(merged.alpha)).toEqual([255, 255]);
    expect(Array.from(current.alpha)).toEqual([255, 0]);
  });
});
