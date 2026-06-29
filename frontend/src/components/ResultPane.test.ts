import { describe, expect, it } from "vitest";

import { canUseComparisonSlider } from "./ResultPane";

describe("canUseComparisonSlider", () => {
  it("only enables comparison when original and result dimensions match", () => {
    expect(canUseComparisonSlider(800, 600, 800, 600)).toBe(true);
    expect(canUseComparisonSlider(800, 600, 400, 300)).toBe(false);
    expect(canUseComparisonSlider(800, 600, undefined, 600)).toBe(false);
    expect(canUseComparisonSlider(undefined, 600, 800, 600)).toBe(false);
  });
});
