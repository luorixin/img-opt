import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compressAndConvertImageFile,
  cropAndEnhanceImageBlob,
  imageToEnhancedResolutionBlob,
  imageToTransparentBackgroundBlob,
} from "./canvasExport";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakeImage(width = 4, height = 4): HTMLImageElement {
  return {
    naturalWidth: width,
    naturalHeight: height,
  } as HTMLImageElement;
}

function installCanvasStub() {
  const toBlobTypes: Array<string | undefined> = [];
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage: vi.fn(),
    getImageData: vi.fn((x: number, y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
    putImageData: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback, type?: string) => {
      toBlobTypes.push(type);
      callback(new Blob(["encoded"], { type: type ?? "image/png" }));
    }),
  };

  vi.stubGlobal("ImageData", class {
    data: Uint8ClampedArray;
    width: number;
    height: number;

    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  });
  vi.stubGlobal("document", {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== "canvas") throw new Error(`unexpected element: ${tagName}`);
      return canvas;
    }),
  });

  return { toBlobTypes };
}

describe("canvasExport formats", () => {
  it("encodes transparent-background exports with the requested WEBP MIME type", async () => {
    const { toBlobTypes } = installCanvasStub();

    const blob = await imageToTransparentBackgroundBlob(fakeImage(), 18, "WEBP");

    expect(blob.type).toBe("image/webp");
    expect(toBlobTypes).toEqual(["image/webp"]);
  });

  it("encodes enhanced-resolution exports with the requested JPEG MIME type", async () => {
    const { toBlobTypes } = installCanvasStub();

    const blob = await imageToEnhancedResolutionBlob(fakeImage(), 2, 0.65, "JPEG");

    expect(blob.type).toBe("image/jpeg");
    expect(toBlobTypes).toEqual(["image/jpeg"]);
  });

  it("encodes crop exports with the requested WEBP MIME type", async () => {
    const { toBlobTypes } = installCanvasStub();

    const blob = await cropAndEnhanceImageBlob(
      fakeImage(),
      { x: 0, y: 0, width: 2, height: 2 },
      2,
      0.65,
      "WEBP",
    );

    expect(blob.type).toBe("image/webp");
    expect(toBlobTypes).toEqual(["image/webp"]);
  });
});

describe("compressAndConvertImageFile safety", () => {
  it("does not allocate a full-size canvas for images above the safe pixel limit", async () => {
    const file = new File(["oversized"], "huge.png", { type: "image/png" });
    const createElement = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:huge");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 12_000;
      naturalHeight = 12_000;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    });

    const result = await compressAndConvertImageFile(file, 0.000001);

    expect(result).toBe(file);
    expect(createElement).not.toHaveBeenCalled();
  });
});
