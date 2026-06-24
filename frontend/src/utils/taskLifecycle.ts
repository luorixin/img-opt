/**
 * @module taskLifecycle
 * @description 提供与 React 无关的异步任务集合操作，便于统一取消多个后台任务。
 */

/**
 * 并发取消所有任务，并返回取消失败、仍需继续跟踪的任务 ID。
 */
export async function cancelTrackedTasks(
  taskIds: string[],
  cancelTask: (taskId: string) => Promise<unknown>,
): Promise<string[]> {
  const results = await Promise.allSettled(taskIds.map((taskId) => cancelTask(taskId)));
  return taskIds.filter((_, index) => results[index].status === "rejected");
}
