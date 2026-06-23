export function calculateUpscaledSize(width: number, height: number, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function applyUnsharpMask(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
): Uint8ClampedArray<ArrayBuffer> {
  const result = new Uint8ClampedArray(sourcePixels) as Uint8ClampedArray<ArrayBuffer>;
  const blurred = boxBlur(sourcePixels, width, height);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const original = sourcePixels[offset + channel];
      const detail = original - blurred[offset + channel];
      result[offset + channel] = clamp(original + detail * amount);
    }
    result[offset + 3] = sourcePixels[offset + 3];
  }

  return result;
}

function boxBlur(sourcePixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const result = new Uint8ClampedArray(sourcePixels.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetOffset = (x + y * width) * 4;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sampleX = x + dx;
          const sampleY = y + dy;
          if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) continue;

          const sampleOffset = (sampleX + sampleY * width) * 4;
          red += sourcePixels[sampleOffset];
          green += sourcePixels[sampleOffset + 1];
          blue += sourcePixels[sampleOffset + 2];
          alpha += sourcePixels[sampleOffset + 3];
          count += 1;
        }
      }

      result[targetOffset] = red / count;
      result[targetOffset + 1] = green / count;
      result[targetOffset + 2] = blue / count;
      result[targetOffset + 3] = alpha / count;
    }
  }

  return result;
}

function clamp(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}
