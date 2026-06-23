export type Point = {
  x: number;
  y: number;
};

export type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type MaskMode = "paint" | "erase";

export type MaskData = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
};

export function createBlankMask(width: number, height: number): MaskData {
  return {
    width,
    height,
    alpha: new Uint8ClampedArray(width * height),
  };
}

export function cloneMask(mask: MaskData): MaskData {
  return {
    width: mask.width,
    height: mask.height,
    alpha: new Uint8ClampedArray(mask.alpha),
  };
}

export function hasPaintedPixels(mask: MaskData): boolean {
  return mask.alpha.some((value) => value > 0);
}

export function maskToBlackWhiteRgba(mask: MaskData): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(mask.width * mask.height * 4) as Uint8ClampedArray<ArrayBuffer>;

  for (let index = 0; index < mask.alpha.length; index += 1) {
    const value = mask.alpha[index] > 0 ? 255 : 0;
    const offset = index * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }

  return pixels;
}

export function mapClientPointToImagePoint(
  clientX: number,
  clientY: number,
  rect: RectLike,
  imageWidth: number,
  imageHeight: number,
): Point {
  const normalizedX = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
  const normalizedY = rect.height === 0 ? 0 : (clientY - rect.top) / rect.height;

  return {
    x: clamp(Math.floor(normalizedX * imageWidth), 0, imageWidth - 1),
    y: clamp(Math.floor(normalizedY * imageHeight), 0, imageHeight - 1),
  };
}

export function applyRectangle(mask: MaskData, start: Point, end: Point, mode: MaskMode): void {
  const minX = clamp(Math.min(start.x, end.x), 0, mask.width - 1);
  const maxX = clamp(Math.max(start.x, end.x), 0, mask.width - 1);
  const minY = clamp(Math.min(start.y, end.y), 0, mask.height - 1);
  const maxY = clamp(Math.max(start.y, end.y), 0, mask.height - 1);
  const value = mode === "paint" ? 255 : 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      mask.alpha[indexFor(mask, x, y)] = value;
    }
  }
}

export function applyBrushLine(
  mask: MaskData,
  start: Point,
  end: Point,
  radius: number,
  mode: MaskMode,
): void {
  const distance = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const steps = Math.max(1, distance);

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = Math.round(start.x + (end.x - start.x) * t);
    const y = Math.round(start.y + (end.y - start.y) * t);
    applyBrushDot(mask, { x, y }, radius, mode);
  }
}

function applyBrushDot(mask: MaskData, center: Point, radius: number, mode: MaskMode): void {
  const safeRadius = Math.max(1, Math.round(radius));
  const minX = clamp(center.x - safeRadius, 0, mask.width - 1);
  const maxX = clamp(center.x + safeRadius, 0, mask.width - 1);
  const minY = clamp(center.y - safeRadius, 0, mask.height - 1);
  const maxY = clamp(center.y + safeRadius, 0, mask.height - 1);
  const value = mode === "paint" ? 255 : 0;
  const radiusSquared = safeRadius * safeRadius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - center.x;
      const dy = y - center.y;
      if (dx * dx + dy * dy <= radiusSquared) {
        mask.alpha[indexFor(mask, x, y)] = value;
      }
    }
  }
}

function indexFor(mask: MaskData, x: number, y: number): number {
  return x + y * mask.width;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
