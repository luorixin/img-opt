import { describe, expect, it } from "vitest";

import { firstImageFile, hasDraggedFiles, imageFiles } from "./fileSelection";

describe("file selection", () => {
  it("returns the first image file", () => {
    const text = new File(["text"], "note.txt", { type: "text/plain" });
    const image = new File(["image"], "photo.png", { type: "image/png" });
    const otherImage = new File(["image"], "photo.jpg", { type: "image/jpeg" });

    expect(firstImageFile([text, image, otherImage])).toBe(image);
  });

  it("returns null when there are no image files", () => {
    const text = new File(["text"], "note.txt", { type: "text/plain" });

    expect(firstImageFile([text])).toBeNull();
    expect(firstImageFile([])).toBeNull();
  });

  it("returns all image files in their original order", () => {
    const text = new File(["text"], "note.txt", { type: "text/plain" });
    const png = new File(["image"], "photo.png", { type: "image/png" });
    const jpeg = new File(["image"], "photo.jpg", { type: "image/jpeg" });

    expect(imageFiles([text, png, jpeg])).toEqual([png, jpeg]);
  });

  it("supports FileList-like array-like objects", () => {
    const image = new File(["image"], "photo.png", { type: "image/png" });
    const fileListLike = {
      0: image,
      length: 1,
    };

    expect(firstImageFile(fileListLike)).toBe(image);
  });

  it("detects file drag events", () => {
    expect(hasDraggedFiles(["Files"])).toBe(true);
    expect(hasDraggedFiles(["text/plain"])).toBe(false);
  });
});
