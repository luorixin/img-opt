import { maskFromRgbaPixels, maskToBlackWhiteRgba, type MaskData } from "./mask";
import { applyTransparentBackground } from "./backgroundTransparency";
import { applyUnsharpMask, calculateUpscaledSize } from "./resolutionEnhancement";
import { calculateCropOutputSize, type CropRect } from "./crop";

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = url;
  });
}

export function maskToPngBlob(mask: MaskData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("无法创建 Mask"));

  context.putImageData(new ImageData(maskToBlackWhiteRgba(mask), mask.width, mask.height), 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Mask 导出失败"));
    }, "image/png");
  });
}

export async function pngBlobToMaskData(blob: Blob): Promise<MaskData> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取智能选区");

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return maskFromRgbaPixels(imageData.data, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function imageToTransparentBackgroundBlob(
  image: HTMLImageElement,
  tolerance: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("无法创建透明背景图片"));

  context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
  const imageData = context.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
  const transparentPixels = applyTransparentBackground(
    imageData.data,
    image.naturalWidth,
    image.naturalHeight,
    tolerance,
  );
  context.putImageData(new ImageData(transparentPixels, image.naturalWidth, image.naturalHeight), 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("透明背景导出失败"));
    }, "image/png");
  });
}

export function imageToEnhancedResolutionBlob(
  image: HTMLImageElement,
  scale: number,
  sharpenAmount: number,
): Promise<Blob> {
  const size = calculateUpscaledSize(image.naturalWidth, image.naturalHeight, scale);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("无法创建高清图片"));

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size.width, size.height);

  const imageData = context.getImageData(0, 0, size.width, size.height);
  const sharpenedPixels = applyUnsharpMask(imageData.data, size.width, size.height, sharpenAmount);
  context.putImageData(new ImageData(sharpenedPixels, size.width, size.height), 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("高清图片导出失败"));
    }, "image/png");
  });
}

export function cropAndEnhanceImageBlob(
  image: HTMLImageElement,
  rect: CropRect,
  scale: number,
  sharpenAmount: number,
): Promise<Blob> {
  const size = calculateCropOutputSize(rect, scale);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("无法创建切图"));

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    size.width,
    size.height,
  );

  const imageData = context.getImageData(0, 0, size.width, size.height);
  const sharpenedPixels = applyUnsharpMask(imageData.data, size.width, size.height, sharpenAmount);
  context.putImageData(new ImageData(sharpenedPixels, size.width, size.height), 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("切图导出失败"));
    }, "image/png");
  });
}
