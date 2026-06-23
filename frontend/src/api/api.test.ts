import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInpaintFormData, inpaintImage } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api", () => {
  it("builds the multipart payload expected by the backend", () => {
    const image = new File(["image"], "source.png", { type: "image/png" });
    const mask = new Blob(["mask"], { type: "image/png" });

    const formData = buildInpaintFormData({
      image,
      mask,
      maskDilate: 4,
      maskBlur: 2,
    });

    const maskPart = formData.get("mask");

    expect(formData.get("image")).toBe(image);
    expect(maskPart).toBeInstanceOf(File);
    expect((maskPart as File).name).toBe("mask.png");
    expect((maskPart as File).type).toBe("image/png");
    expect((maskPart as File).size).toBe(mask.size);
    expect(formData.get("mask_dilate")).toBe("4");
    expect(formData.get("mask_blur")).toBe("2");
  });

  it("formats structured backend error details for display", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            detail: {
              code: "ENGINE_UNAVAILABLE",
              message: "sidecar offline",
              hint: "Start IOPaint with MPS.",
            },
          }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      inpaintImage({
        image: new File(["image"], "source.png", { type: "image/png" }),
        mask: new Blob(["mask"], { type: "image/png" }),
        maskDilate: 0,
        maskBlur: 0,
      }),
    ).rejects.toThrow("sidecar offline Start IOPaint with MPS.");
  });
});
