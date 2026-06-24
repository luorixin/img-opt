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

export class AsyncQueue {
  private readonly concurrency: number;
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
      throw new Error("concurrency must be a positive integer");
    }

    this.concurrency = concurrency;
  }

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.running += 1;

        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running -= 1;
          this.next();
        }
      };

      this.queue.push(run);
      this.next();
    });
  }

  private next(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const run = this.queue.shift();
      run?.();
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }
}

export async function processBatchImages(
  files: File[],
  operation: BatchImageOperation,
  processor: BatchImageProcessor,
  onProgress?: (progress: BatchImageProgress) => void,
  dependencies: BatchImageDependencies = {},
): Promise<BatchImageResult[]> {
  const total = files.length;
  const imageLoader = dependencies.loadImage ?? loadImage;
  const createObjectURL = dependencies.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL = dependencies.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);

  let startedCount = 0;
  const queue = new AsyncQueue(3);

  const tasks = files.map((file) => {
    return queue.add(async () => {
      startedCount += 1;
      onProgress?.({ current: startedCount, total, filename: file.name });
      
      const objectUrl = createObjectURL(file);
      try {
        const image = await imageLoader(objectUrl);
        const blob = await processor(image, file);
        return {
          blob,
          filename: buildBatchFilename(file.name, operation),
          sourceName: file.name,
        };
      } finally {
        revokeObjectURL(objectUrl);
      }
    });
  });

  return Promise.all(tasks);
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
