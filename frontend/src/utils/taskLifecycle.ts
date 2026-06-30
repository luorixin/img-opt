/**
 * @module taskLifecycle
 * @description 提供与 React 无关的异步任务集合操作，便于统一取消多个后台任务。
 */

export type TaskRecordStatus =
  | "queued"
  | "pending"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskProgressUpdate = {
  state?: string;
  status: string;
  progress?: number;
  message?: string;
  result_url?: string;
  error?: string;
};

export type TaskRecord = {
  id: string;
  label: string;
  status: TaskRecordStatus;
  progress: number;
  message: string;
  createdAt: number;
  finishedAt?: number;
};

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

/** 创建任务中心初始记录，默认表示任务已经成功提交到后端队列。 */
export function createTaskRecord(taskId: string, label: string, now = Date.now()): TaskRecord {
  return {
    id: taskId,
    label,
    status: "queued",
    progress: 0,
    message: "任务已入队",
    createdAt: now,
  };
}

/** 将后端任务状态合并到前端任务中心记录，并统一完成、失败、取消时的收尾字段。 */
export function mergeTaskProgress(
  record: TaskRecord,
  update: TaskProgressUpdate,
  now = Date.now(),
): TaskRecord {
  const status = normalizeTaskStatus(update.status);
  const terminal = isTerminalTaskStatus(status);
  const nextProgress = update.progress ?? (status === "completed" ? 100 : record.progress);
  return {
    ...record,
    status,
    progress: clampProgress(nextProgress),
    message: taskMessageForStatus(update, status),
    finishedAt: terminal ? (record.finishedAt ?? now) : undefined,
  };
}

/** 判断任务是否仍可被取消或需要在任务中心中标记为活跃。 */
export function isTaskRecordActive(record: TaskRecord): boolean {
  return !isTerminalTaskStatus(record.status);
}

function normalizeTaskStatus(status: string): TaskRecordStatus {
  if (status === "completed" || status === "failed" || status === "cancelled") return status;
  if (status === "running" || status === "pending" || status === "queued" || status === "retrying") return status;
  return "running";
}

function isTerminalTaskStatus(status: TaskRecordStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function taskMessageForStatus(update: TaskProgressUpdate, status: TaskRecordStatus): string {
  if (update.error) return update.error;
  if (update.message) return update.message;
  if (status === "completed") return "任务完成";
  if (status === "failed") return "任务失败";
  if (status === "cancelled") return "任务已取消";
  if (status === "retrying") return "任务重试中";
  if (status === "pending" || status === "queued") return "任务排队中";
  return "任务处理中";
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}
