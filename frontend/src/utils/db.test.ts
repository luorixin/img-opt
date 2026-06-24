import { describe, expect, it, vi } from "vitest";

import { DebouncedSaveQueue } from "./db";

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
