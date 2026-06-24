import { loadImage } from "./canvasExport";

export type BatchImageOperation = "transparent" | "enhance";

export type BatchImageResult = {
  blob: Blob;
  filename: string;
  sourceName: string;
};

export type BatchImageProgress = {
  current: number;
  total: number;
  filename: string;
};

export type BatchImageProcessor = (image: HTMLImageElement, file: File) => Promise<Blob>;

export type BatchImageDependencies = {
  loadImage?: (url: string) => Promise<HTMLImageElement>;
  createObjectURL?: (file: File) => string;
  revokeObjectURL?: (url: string) => void;
};

export async function processBatchImages(
  files: File[],
  operation: BatchImageOperation,
  processor: BatchImageProcessor,
  onProgress?: (progress: BatchImageProgress) => void,
  dependencies: BatchImageDependencies = {},
): Promise<BatchImageResult[]> {
  const results: BatchImageResult[] = [];
  const total = files.length;
  const imageLoader = dependencies.loadImage ?? loadImage;
  const createObjectURL = dependencies.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL = dependencies.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    onProgress?.({ current: index + 1, total, filename: file.name });
    const objectUrl = createObjectURL(file);

    try {
      const image = await imageLoader(objectUrl);
      const blob = await processor(image, file);
      results.push({
        blob,
        filename: buildBatchFilename(file.name, operation),
        sourceName: file.name,
      });
    } finally {
      revokeObjectURL(objectUrl);
    }
  }

  return results;
}

export function buildBatchFilename(sourceName: string, operation: BatchImageOperation): string {
  const baseName = sourceName.replace(/\.[^.]*$/, "");
  const safeName = sanitizeFilename(baseName || "image");
  const suffix = operation === "transparent" ? "transparent" : "enhanced";
  return `${safeName}-${suffix}.png`;
}

export function sanitizeFilename(name: string): string {
  const sanitized = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return sanitized || "image";
}
