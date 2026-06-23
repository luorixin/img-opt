export function applyTransparentBackground(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance: number,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(sourcePixels) as Uint8ClampedArray<ArrayBuffer>;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const backgroundSamples = collectCornerSamples(sourcePixels, width, height);
  const toleranceSquared = tolerance * tolerance * 3;

  for (const index of edgeIndexes(width, height)) {
    if (isBackgroundPixel(sourcePixels, index, backgroundSamples, toleranceSquared)) {
      visited[index] = 1;
      queue.push(index);
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    pixels[index * 4 + 3] = 0;

    for (const next of neighbors(index, width, height)) {
      if (!visited[next] && isBackgroundPixel(sourcePixels, next, backgroundSamples, toleranceSquared)) {
        visited[next] = 1;
        queue.push(next);
      }
    }
  }

  return pixels;
}

function collectCornerSamples(pixels: Uint8ClampedArray, width: number, height: number): number[][] {
  const indexes = [0, width - 1, (height - 1) * width, width * height - 1];
  return indexes.map((index) => {
    const offset = index * 4;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  });
}

function edgeIndexes(width: number, height: number): number[] {
  const indexes: number[] = [];
  for (let x = 0; x < width; x += 1) {
    indexes.push(x);
    indexes.push(x + (height - 1) * width);
  }
  for (let y = 1; y < height - 1; y += 1) {
    indexes.push(y * width);
    indexes.push(width - 1 + y * width);
  }
  return indexes;
}

function neighbors(index: number, width: number, height: number): number[] {
  const x = index % width;
  const y = Math.floor(index / width);
  const result: number[] = [];
  if (x > 0) result.push(index - 1);
  if (x < width - 1) result.push(index + 1);
  if (y > 0) result.push(index - width);
  if (y < height - 1) result.push(index + width);
  return result;
}

function isBackgroundPixel(
  pixels: Uint8ClampedArray,
  index: number,
  samples: number[][],
  toleranceSquared: number,
): boolean {
  const offset = index * 4;
  const red = pixels[offset];
  const green = pixels[offset + 1];
  const blue = pixels[offset + 2];

  return samples.some(([sampleRed, sampleGreen, sampleBlue]) => {
    const dr = red - sampleRed;
    const dg = green - sampleGreen;
    const db = blue - sampleBlue;
    return dr * dr + dg * dg + db * db <= toleranceSquared;
  });
}
