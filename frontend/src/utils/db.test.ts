import { afterEach, describe, expect, it, vi } from "vitest";

import { DebouncedSaveQueue, compressMaskRLE, decompressMaskRLE, loadAppState, saveAppState } from "./db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("DebouncedSaveQueue", () => {
  it("serializes overlapping writes", async () => {
    vi.useFakeTimers();
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writes: number[] = [];
    const queue = new DebouncedSaveQueue<number>(async (value) => {
      writes.push(value);
      if (value === 1) await firstPending;
    }, 10);

    queue.schedule(1);
    await vi.advanceTimersByTimeAsync(10);
    queue.schedule(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(writes).toEqual([1]);

    releaseFirst?.();
    await queue.flush();
    expect(writes).toEqual([1, 2]);
    vi.useRealTimers();
  });

  it("flushes a pending write immediately", async () => {
    const writer = vi.fn(async (_value: string) => undefined);
    const queue = new DebouncedSaveQueue<string>(writer, 60_000);

    queue.schedule("latest");
    await queue.flush();

    expect(writer).toHaveBeenCalledWith("latest");
  });

  it("waits for an in-flight write before clearing", async () => {
    vi.useFakeTimers();
    let releaseWrite: (() => void) | undefined;
    const pendingWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const queue = new DebouncedSaveQueue<number>(async () => pendingWrite, 10);
    queue.schedule(1);
    await vi.advanceTimersByTimeAsync(10);

    let finished = false;
    const cancellation = queue.cancelPendingAndWait().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);

    releaseWrite?.();
    await cancellation;
    expect(finished).toBe(true);
    vi.useRealTimers();
  });
});

describe("Mask RLE 游程编码压缩算法", () => {
  it("能正确压缩和解压空像素数组", () => {
    const alpha = new Uint8ClampedArray(0);
    const compressed = compressMaskRLE(alpha);
    expect(compressed.length).toBe(0);
    const decompressed = decompressMaskRLE(compressed, 0);
    expect(decompressed.length).toBe(0);
  });

  it("能高效压缩全相同颜色的像素数组", () => {
    const size = 1000;
    const alpha = new Uint8ClampedArray(size).fill(255);
    const compressed = compressMaskRLE(alpha);
    // 应该只记录两个数值：值255，以及连续的个数1000
    expect(Array.from(compressed)).toEqual([255, 1000]);
    const decompressed = decompressMaskRLE(compressed, size);
    expect(decompressed).toEqual(alpha);
  });

  it("能正确压缩和还原交替涂抹的像素数组", () => {
    const alpha = new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 255, 255, 255]);
    const compressed = compressMaskRLE(alpha);
    expect(Array.from(compressed)).toEqual([
      0, 3,
      255, 2,
      0, 1,
      255, 3
    ]);
    const decompressed = decompressMaskRLE(compressed, alpha.length);
    expect(decompressed).toEqual(alpha);
  });

  it("解压时具备健全的边界溢出截断保护", () => {
    const alpha = new Uint8ClampedArray([255, 255, 0, 0]);
    const compressed = compressMaskRLE(alpha);
    // 如果还原的目标长度设为 3（小于原本长度 4），解压算法应能安全截断且不报错
    const decompressed = decompressMaskRLE(compressed, 3);
    expect(Array.from(decompressed)).toEqual([255, 255, 0]);
  });
});

describe("IndexedDB 工作区迁移", () => {
  it("旧版内嵌 imageFile 加载后首次保存会写入独立图片槽", async () => {
    const legacyFile = new File(["legacy-image"], "legacy.png", {
      type: "image/png",
      lastModified: 123,
    });
    const records = new Map<string, unknown>([
      [
        "latestState",
        {
          imageFile: legacyFile,
          mask: null,
          cropRects: [],
          settings: {
            brushSize: 24,
            maskDilate: 4,
            maskBlur: 2,
            backgroundTolerance: 18,
            upscaleFactor: 2,
            tool: "rectangle",
          },
        },
      ],
    ]);
    installFakeIndexedDB(records);

    const loaded = await loadAppState();
    expect(loaded?.imageFile).toBe(legacyFile);

    await saveAppState(legacyFile, null, [], loaded!.settings);

    expect(records.get("latestImageFile")).toBe(legacyFile);
    expect((records.get("latestState") as { imageFile: File | null }).imageFile).toBeNull();
  });
});

function installFakeIndexedDB(records: Map<string, unknown>) {
  const database: any = {
    objectStoreNames: {
      contains: () => true,
    },
    createObjectStore: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn((_storeName: string, _mode: IDBTransactionMode) => createTransaction(records)),
  };

  vi.stubGlobal("indexedDB", {
    open: vi.fn(() => {
      const request: any = {
        result: database as unknown as IDBDatabase,
        error: null,
      };
      queueMicrotask(() => request.onsuccess?.({} as Event));
      return request;
    }),
  });
}

function createTransaction(records: Map<string, unknown>) {
  let pendingOperations = 0;
  const transaction: any = {
    error: null,
    objectStore: vi.fn(() => ({
      get: (key: string) => scheduleRequest(() => records.get(key)),
      put: (value: unknown, key: string) => scheduleRequest(() => {
        records.set(key, value);
        return key;
      }),
      delete: (key: string) => scheduleRequest(() => {
        records.delete(key);
        return undefined;
      }),
    })),
  };

  function scheduleRequest(readValue: () => unknown) {
    pendingOperations += 1;
    const request: any = {
      error: null,
    };
    queueMicrotask(() => {
      request.result = readValue();
      request.onsuccess?.({} as Event);
      pendingOperations -= 1;
      if (pendingOperations === 0) {
        transaction.oncomplete?.({} as Event);
      }
    });
    return request;
  }

  return transaction as IDBTransaction;
}
