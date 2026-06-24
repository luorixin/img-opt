import { describe, expect, it, vi } from "vitest";

import { cancelTrackedTasks } from "./taskLifecycle";

describe("task lifecycle", () => {
  it("cancels every tracked task and retains only failures", async () => {
    const cancel = vi.fn(async (taskId: string) => {
      if (taskId === "task-2") throw new Error("cancel failed");
    });

    const remaining = await cancelTrackedTasks(["task-1", "task-2", "task-3"], cancel);

    expect(cancel.mock.calls.map(([taskId]) => taskId)).toEqual(["task-1", "task-2", "task-3"]);
    expect(remaining).toEqual(["task-2"]);
  });
});
