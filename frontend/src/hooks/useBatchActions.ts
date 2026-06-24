/**
 * @module useBatchActions
 * @description 组织批量透明背景与批量超分任务，并同步下载及任务生命周期状态。
 */

import { processBatchImages, type BatchImageOperation } from "../utils/batchProcessing";
import { imageToTransparentBackgroundBlob, imageToEnhancedResolutionBlob } from "../utils/canvasExport";
import { downloadBlobs, downloadBlob } from "../utils/crop";
import { imageFiles } from "../utils/fileSelection";
import { removeBackground, upscaleImage } from "../api/api";
import { useStore } from "../store/useStore";

/**
 * 创建批量图片处理动作；AI 模式下每个子任务都会独立登记和注销。
 */
export function useBatchActions(
  registerTask: (taskId: string) => void,
  unregisterTask: (taskId: string) => void,
) {
  const setStatus = useStore((state) => state.setStatus);
  const setBusy = useStore((state) => state.setBusy);
  const setBatchProgress = useStore((state) => state.setBatchProgress);
  const setResultUrl = useStore((state) => state.setResultUrl);
  const setResultFilename = useStore((state) => state.setResultFilename);
  const backgroundTolerance = useStore((state) => state.backgroundTolerance);
  const upscaleFactor = useStore((state) => state.upscaleFactor);
  const resultUrl = useStore((state) => state.resultUrl);
  const algoMode = useStore((state) => state.algoMode);

  async function processBatch(operation: BatchImageOperation, fileList: FileList | null) {
    const files = fileList ? imageFiles(fileList) : [];
    if (files.length === 0) {
      setStatus("请选择要批量处理的图片");
      return;
    }

    setBusy(true);
    setStatus(`批量处理中，0 / ${files.length}`);
    try {
      const results = await processBatchImages(
        files,
        operation,
        async (source, file) => {
          if (operation === "transparent") {
            if (algoMode === "ai") {
              return removeBackground({
                image: file,
                onTaskSubmitted: registerTask,
                onTaskSettled: unregisterTask,
              });
            }
            return imageToTransparentBackgroundBlob(source, backgroundTolerance);
          }
          if (algoMode === "ai") {
            return upscaleImage({
              image: file,
              upscaleFactor,
              onTaskSubmitted: registerTask,
              onTaskSettled: unregisterTask,
            });
          }
          return imageToEnhancedResolutionBlob(source, upscaleFactor, 0.65);
        },
        ({ current, total, filename }) => {
          const label = operation === "transparent" ? "透明" : "清晰";
          setStatus(`批量${label}处理中，${current} / ${total}：${filename}`);
          setBatchProgress({ current, total, filename, operation: label });
        },
      );

      if (results.length === 0) {
        setStatus("没有可处理的图片");
        return;
      }

      const lastResult = results[results.length - 1];
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(lastResult.blob));
      setResultFilename(lastResult.filename);
      downloadBlobs(results.map(({ blob, filename }) => ({ blob, filename })), downloadBlob);
      setStatus(`批量完成，已下载 ${results.length} 张`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "批量处理失败");
    } finally {
      setBusy(false);
      setBatchProgress(null);
    }
  }

  return { processBatch };
}
