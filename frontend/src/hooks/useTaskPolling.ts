/**
 * @module useTaskPolling
 * @description 管理智能选区请求，以及前端当前仍在执行的全部 Celery 任务 ID。
 */

import { useCallback, useState, useEffect } from "react";
import { cancelInpaintTask, segmentImageMask } from "../api/api";
import { useStore } from "../store/useStore";
import { pngBlobToMaskData } from "../utils/canvasExport";
import { mergeMasks } from "../utils/mask";
import { cancelTrackedTasks } from "../utils/taskLifecycle";

/**
 * 管理智能分割副作用与 Celery 任务集合，向界面提供统一取消入口。
 */
export function useTaskPolling(reloadOverlay: () => void) {
  const [activeTaskIds, setActiveTaskIds] = useState<string[]>([]);

  const smartSegmentPoint = useStore((state) => state.smartSegmentPoint);
  const smartSegmentRequestId = useStore((state) => state.smartSegmentRequestId);
  const setBusy = useStore((state) => state.setBusy);
  const setStatus = useStore((state) => state.setStatus);

  useEffect(() => {
    if (!smartSegmentPoint || smartSegmentRequestId === 0) return;
    const activeImage = useStore.getState().image;
    if (!activeImage || useStore.getState().busy) return;
    const point = smartSegmentPoint;
    const selectedImage = activeImage;

    let cancelled = false;
    async function runSmartSegment() {
      setBusy(true);
      setStatus(`智能选区处理中：${point.x}, ${point.y}`);
      try {
        const maskBlob = await segmentImageMask({
          image: selectedImage.file,
          x: point.x,
          y: point.y,
        });
        const generatedMask = await pngBlobToMaskData(maskBlob);
        if (cancelled || useStore.getState().image?.file !== selectedImage.file) return;

        const currentMask = useStore.getState().mask;
        if (!currentMask) return;
        useStore.getState().pushSmartSegmentHistory();
        useStore.setState((state) => ({
          mask: mergeMasks(currentMask, generatedMask),
          historyTick: state.historyTick + 1,
          status: "智能选区已添加，可继续点击或用橡皮擦修整",
        }));
        useStore.getState().persistToDB();
        reloadOverlay();
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "智能选区失败");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void runSmartSegment();
    return () => {
      cancelled = true;
    };
  }, [
    reloadOverlay,
    setBusy,
    setStatus,
    smartSegmentPoint,
    smartSegmentRequestId,
  ]);

  /** 登记刚入队的任务，使用去重数组触发 React 重新渲染。 */
  const registerTask = useCallback((taskId: string) => {
    setActiveTaskIds((current) => current.includes(taskId) ? current : [...current, taskId]);
  }, []);

  /** 在任务成功、失败、取消或轮询超时后移除对应 ID。 */
  const unregisterTask = useCallback((taskId: string) => {
    setActiveTaskIds((current) => current.filter((candidate) => candidate !== taskId));
  }, []);

  /** 取消当前登记的全部任务；失败的 ID 会保留，允许用户再次操作。 */
  async function cancelActiveTasks() {
    if (activeTaskIds.length === 0) return;
    setStatus(`正在取消 ${activeTaskIds.length} 个任务`);
    const remaining = await cancelTrackedTasks(activeTaskIds, cancelInpaintTask);
    setActiveTaskIds(remaining);
    setStatus(remaining.length === 0 ? "任务已取消" : `${remaining.length} 个任务取消失败`);
  }

  return { activeTaskIds, registerTask, unregisterTask, cancelActiveTasks };
}
