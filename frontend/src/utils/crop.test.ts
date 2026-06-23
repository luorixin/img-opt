import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCropFilename,
  calculateCropOutputSize,
  downloadBlob,
  downloadBlobs,
  normalizeCropRect,
} from "./crop";

describe("crop helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("normalizes reversed crop drags and clamps to image bounds", () => {
    const rect = normalizeCropRect(
      { x: 120, y: 90 },
      { x: -10, y: 20 },
      100,
      80,
    );

    expect(rect).toEqual({ x: 0, y: 20, width: 100, height: 60 });
  });

  it("returns null for zero-size crop selections", () => {
    expect(normalizeCropRect({ x: 10, y: 10 }, { x: 10, y: 20 }, 100, 80)).toBeNull();
    expect(normalizeCropRect({ x: 10, y: 10 }, { x: 20, y: 10 }, 100, 80)).toBeNull();
  });

  it("calculates enhanced crop output size", () => {
    expect(calculateCropOutputSize({ x: 5, y: 5, width: 100, height: 80 }, 2)).toEqual({
      width: 200,
      height: 160,
    });
  });

  it("builds descriptive crop filenames", () => {
    expect(buildCropFilename({ x: 0, y: 0, width: 320, height: 180 }, 3)).toBe("crop-320x180-3x.png");
    expect(buildCropFilename({ x: 0, y: 0, width: 320, height: 180 }, 3, 2)).toBe("crop-02-320x180-3x.png");
  });

  it("downloads blobs and revokes object URLs", () => {
    const click = vi.fn();
    const appendChild = vi.fn();
    const remove = vi.fn();
    const link = {
      href: "",
      download: "",
      click,
      remove,
    } as unknown as HTMLAnchorElement;
    const createElement = vi.fn(() => link);
    const createObjectURL = vi.fn(() => "blob:crop");
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("document", {
      createElement,
      body: { appendChild },
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    downloadBlob(new Blob(["crop"], { type: "image/png" }), "crop.png");

    expect(createElement).toHaveBeenCalledWith("a");
    expect(link.href).toBe("blob:crop");
    expect(link.download).toBe("crop.png");
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:crop");
  });

  it("downloads multiple blobs with matching filenames", () => {
    const downloadSpy = vi.fn();
    const files = [
      { blob: new Blob(["a"], { type: "image/png" }), filename: "crop-01.png" },
      { blob: new Blob(["b"], { type: "image/png" }), filename: "crop-02.png" },
    ];

    downloadBlobs(files, downloadSpy);

    expect(downloadSpy).toHaveBeenNthCalledWith(1, files[0].blob, "crop-01.png");
    expect(downloadSpy).toHaveBeenNthCalledWith(2, files[1].blob, "crop-02.png");
  });
});
