import { describe, expect, it, vi } from "vitest";

import {
  cancelTrackedTasks,
  createTaskRecord,
  isTaskRecordActive,
  mergeTaskProgress,
} from "./taskLifecycle";

describe("task lifecycle", () => {
  it("cancels every tracked task and retains only failures", async () => {
    const cancel = vi.fn(async (taskId: string) => {
      if (taskId === "task-2") throw new Error("cancel failed");
    });

    const remaining = await cancelTrackedTasks(["task-1", "task-2", "task-3"], cancel);

    expect(cancel.mock.calls.map(([taskId]) => taskId)).toEqual(["task-1", "task-2", "task-3"]);
    expect(remaining).toEqual(["task-2"]);
  });

  it("creates and updates task center records from backend progress", () => {
    const queued = createTaskRecord("task-1", "批量清晰：cat.png", 1000);

    expect(queued).toMatchObject({
      id: "task-1",
      label: "批量清晰：cat.png",
      status: "queued",
      progress: 0,
      message: "任务已入队",
      createdAt: 1000,
    });
    expect(isTaskRecordActive(queued)).toBe(true);

    const running = mergeTaskProgress(
      queued,
      {
        state: "STARTED",
        status: "running",
        progress: 30,
        message: "Running upscale",
      },
      2000,
    );

    expect(running).toMatchObject({
      status: "running",
      progress: 30,
      message: "Running upscale",
      finishedAt: undefined,
    });
    expect(isTaskRecordActive(running)).toBe(true);

    const completed = mergeTaskProgress(
      running,
      {
        state: "SUCCESS",
        status: "completed",
        result_url: "/api/tasks/task-1/result",
      },
      3000,
    );

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      message: "任务完成",
      finishedAt: 3000,
    });
    expect(isTaskRecordActive(completed)).toBe(false);
  });
});
