/**
 * @module TaskCenter
 * @description 展示后端异步任务的最近状态、进度和统一操作入口。
 */

import { CheckCircle2, CircleSlash2, Loader2, XCircle } from "lucide-react";

import type { TaskRecord, TaskRecordStatus } from "../utils/taskLifecycle";

type TaskCenterProps = {
  records: TaskRecord[];
  canCancelTask: boolean;
  onCancelActive: () => void;
  onClearSettled: () => void;
};

/** 渲染任务中心列表，帮助用户理解批量 AI 或长耗时任务当前运行到哪里。 */
export function TaskCenter({
  records,
  canCancelTask,
  onCancelActive,
  onClearSettled,
}: TaskCenterProps) {
  const settledCount = records.filter((record) => isSettled(record.status)).length;

  return (
    <div className="taskCenter">
      <div className="taskCenterActions">
        <button className="secondaryButton" disabled={!canCancelTask} onClick={onCancelActive}>
          取消活跃任务
        </button>
        <button className="secondaryButton" disabled={settledCount === 0} onClick={onClearSettled}>
          清除已结束
        </button>
      </div>

      {records.length === 0 ? (
        <div className="taskEmpty">暂无后台任务</div>
      ) : (
        <ul className="taskList">
          {records.map((record) => (
            <li className="taskItem" key={record.id}>
              <div className="taskIcon" aria-hidden="true">
                {iconForStatus(record.status)}
              </div>
              <div className="taskInfo">
                <div className="taskTitleRow">
                  <strong>{record.label}</strong>
                  <span className={`taskStatus taskStatus-${record.status}`}>{labelForStatus(record.status)}</span>
                </div>
                <div className="taskMessage">{record.message}</div>
                <div className="taskProgressTrack">
                  <span className="taskProgressFill" style={{ width: `${record.progress}%` }} />
                </div>
                <div className="taskMeta">
                  <span>{record.progress}%</span>
                  <span title={record.id}>{shortTaskId(record.id)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function iconForStatus(status: TaskRecordStatus) {
  if (status === "completed") return <CheckCircle2 size={18} />;
  if (status === "failed") return <XCircle size={18} />;
  if (status === "cancelled") return <CircleSlash2 size={18} />;
  return <Loader2 className="spin" size={18} />;
}

function labelForStatus(status: TaskRecordStatus): string {
  return {
    queued: "排队",
    pending: "等待",
    running: "处理中",
    retrying: "重试",
    completed: "完成",
    failed: "失败",
    cancelled: "取消",
  }[status];
}

function isSettled(status: TaskRecordStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function shortTaskId(taskId: string): string {
  return taskId.length > 10 ? `${taskId.slice(0, 6)}...${taskId.slice(-4)}` : taskId;
}
