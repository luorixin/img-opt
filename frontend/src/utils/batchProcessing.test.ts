import { afterEach, describe, expect, it, vi } from "vitest";

import { buildBatchFilename, processBatchImages, sanitizeFilename } from "./batchProcessing";

describe("batch processing helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds safe operation filenames", () => {
    expect(buildBatchFilename("Product Hero.JPG", "transparent")).toBe("Product-Hero-transparent.png");
    expect(buildBatchFilename("商品 主图.webp", "enhance")).toBe("image-enhanced.png");
  });

  it("sanitizes empty and punctuation-only names", () => {
    expect(sanitizeFilename("   ")).toBe("image");
    expect(sanitizeFilename("...---")).toBe("image");
    expect(sanitizeFilename("pack shot_01")).toBe("pack-shot_01");
  });

  it("processes files in order and revokes object URLs", async () => {
    const imageElement = {} as HTMLImageElement;
    const loadImage = vi.fn(async () => imageElement);
    const processor = vi.fn(async (_image: HTMLImageElement, file: File) => new Blob([file.name]));
    const progress = vi.fn();
    const createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
    const revokeObjectURL = vi.fn();

    const files = [
      new File(["a"], "one.png", { type: "image/png" }),
      new File(["b"], "two.jpg", { type: "image/jpeg" }),
    ];

    const results = await processBatchImages(files, "enhance", processor, progress, {
      loadImage,
      createObjectURL,
      revokeObjectURL,
    });

    expect(createObjectURL).toHaveBeenNthCalledWith(1, files[0]);
    expect(createObjectURL).toHaveBeenNthCalledWith(2, files[1]);
    expect(loadImage).toHaveBeenNthCalledWith(1, "blob:one.png");
    expect(loadImage).toHaveBeenNthCalledWith(2, "blob:two.jpg");
    expect(processor).toHaveBeenNthCalledWith(1, imageElement, files[0]);
    expect(processor).toHaveBeenNthCalledWith(2, imageElement, files[1]);
    expect(progress).toHaveBeenNthCalledWith(1, { current: 1, total: 2, filename: "one.png" });
    expect(progress).toHaveBeenNthCalledWith(2, { current: 2, total: 2, filename: "two.jpg" });
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:one.png");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:two.jpg");
    expect(results.map((result) => result.filename)).toEqual(["one-enhanced.png", "two-enhanced.png"]);
  });

});
