import type { Point } from "./mask";

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function normalizeCropRect(
  start: Point,
  end: Point,
  imageWidth: number,
  imageHeight: number,
): CropRect | null {
  const startX = clamp(start.x, 0, imageWidth);
  const endX = clamp(end.x, 0, imageWidth);
  const startY = clamp(start.y, 0, imageHeight);
  const endY = clamp(end.y, 0, imageHeight);
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  if (width === 0 || height === 0) return null;
  return { x, y, width, height };
}

export function calculateCropOutputSize(rect: CropRect, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

export function buildCropFilename(rect: CropRect, scale: number, index?: number): string {
  const sequence = index === undefined ? "" : `${String(index).padStart(2, "0")}-`;
  return `crop-${sequence}${rect.width}x${rect.height}-${scale}x.png`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadBlobs(
  files: Array<{ blob: Blob; filename: string }>,
  download: (blob: Blob, filename: string) => void = downloadBlob,
): void {
  for (const file of files) {
    download(file.blob, file.filename);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
