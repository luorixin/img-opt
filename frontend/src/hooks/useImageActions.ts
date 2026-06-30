/**
 * @module useImageActions
 * @description 封装单图修复、透明背景、超分、切图和提示词重绘工作流。
 */

import { inpaintImage, promptInpaintImage, removeBackground, upscaleImage } from "../api/api";
import {
  cropAndEnhanceImageBlob,
  imageToEnhancedResolutionBlob,
  imageToTransparentBackgroundBlob,
  maskToPngBlob,
} from "../utils/canvasExport";
import {
  buildCropFilename,
  calculateCropOutputSize,
  downloadBlob,
  downloadBlobs,
} from "../utils/crop";
import { hasPaintedPixels } from "../utils/mask";
import { useStore } from "../store/useStore";
import type { TaskProgressUpdate } from "../utils/taskLifecycle";

/**
 * 创建单图处理动作，并通过任务登记回调跟踪所有异步请求。
 */
export function useImageActions(
  imageElementRef: React.RefObject<HTMLImageElement | null>,
  registerTask: (id: string, label?: string) => void,
  updateTask: (id: string, update: TaskProgressUpdate) => void,
  unregisterTask: (id: string) => void,
) {
  const image = useStore((state) => state.image);
  const prompt = useStore((state) => state.prompt);
  const maskDilate = useStore((state) => state.maskDilate);
  const maskBlur = useStore((state) => state.maskBlur);
  const backgroundTolerance = useStore((state) => state.backgroundTolerance);
  const upscaleFactor = useStore((state) => state.upscaleFactor);
  const cropRects = useStore((state) => state.cropRects);
  const resultUrl = useStore((state) => state.resultUrl);
  const algoMode = useStore((state) => state.algoMode);
  const exportFormat = useStore((state) => state.exportFormat);

  const setStatus = useStore((state) => state.setStatus);
  const setBusy = useStore((state) => state.setBusy);
  const setResultUrl = useStore((state) => state.setResultUrl);
  const setResultFilename = useStore((state) => state.setResultFilename);

  async function repairImage() {
    const activeMask = useStore.getState().mask;
    if (!image || !activeMask) return;
    if (!hasPaintedPixels(activeMask)) {
      setStatus("Mask 为空");
      return;
    }

    setBusy(true);
    setStatus("修复中");
    try {
      const maskBlob = await maskToPngBlob(activeMask);
      const result = await inpaintImage({
        image: image.file,
        mask: maskBlob,
        maskDilate,
        maskBlur,
        onProgress: setStatus,
        onTaskSubmitted: (taskId) => registerTask(taskId, "图片修复"),
        onTaskProgress: updateTask,
        onTaskSettled: unregisterTask,
      });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(result));
      setResultFilename("cleaned.png");
      setStatus("修复完成");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "修复失败");
    } finally {
      setBusy(false);
    }
  }

  async function makeBackgroundTransparent() {
    const source = imageElementRef.current;
    if (!source || !image) return;

    setBusy(true);
    setStatus("背景透明处理中");
    try {
      let result: Blob;
      if (algoMode === "ai") {
        result = await removeBackground({
          image: image.file,
          format: exportFormat === "JPEG" ? "PNG" : exportFormat,
          onProgress: setStatus,
          onTaskSubmitted: (taskId) => registerTask(taskId, "AI 透明背景"),
          onTaskProgress: updateTask,
          onTaskSettled: unregisterTask,
        });
      } else {
        result = await imageToTransparentBackgroundBlob(
          source,
          backgroundTolerance,
          exportFormat === "JPEG" ? "PNG" : exportFormat,
        );
      }
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(result));
      const ext = (exportFormat === "JPEG" ? "PNG" : exportFormat).toLowerCase();
      setResultFilename(`transparent-background.${ext}`);
      setStatus("透明背景完成");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "透明背景失败");
    } finally {
      setBusy(false);
    }
  }

  async function enhanceResolution() {
    const source = imageElementRef.current;
    if (!source || !image) return;

    setBusy(true);
    setStatus("清晰增强处理中");
    try {
      let result: Blob;
      if (algoMode === "ai") {
        result = await upscaleImage({
          image: image.file,
          upscaleFactor,
          format: exportFormat,
          onProgress: setStatus,
          onTaskSubmitted: (taskId) => registerTask(taskId, `AI 清晰增强 ${upscaleFactor}x`),
          onTaskProgress: updateTask,
          onTaskSettled: unregisterTask,
        });
      } else {
        result = await imageToEnhancedResolutionBlob(source, upscaleFactor, 0.65, exportFormat);
      }
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(result));
      const ext = exportFormat.toLowerCase();
      setResultFilename(`enhanced-${upscaleFactor}x.${ext}`);
      setStatus(`${source.naturalWidth * upscaleFactor} x ${source.naturalHeight * upscaleFactor}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "清晰增强失败");
    } finally {
      setBusy(false);
    }
  }

  async function cropAndDownload() {
    const source = imageElementRef.current;
    if (!source || cropRects.length === 0 || !image) {
      setStatus("请先框选切图区域");
      return;
    }

    setBusy(true);
    setStatus(`切图处理中，${cropRects.length} 个区域`);
    try {
      const settledFiles = await Promise.allSettled(
        cropRects.map(async (rect, index) => {
          let blob: Blob;
          if (algoMode === "ai") {
            const cropStr = `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`;
            blob = await upscaleImage({
              image: image.file,
              upscaleFactor,
              crop: cropStr,
              format: exportFormat,
              onProgress: (msg) => setStatus(`区域 ${index + 1}: ${msg}`),
              onTaskSubmitted: (taskId) => registerTask(taskId, `AI 切图区域 ${index + 1}`),
              onTaskProgress: updateTask,
              onTaskSettled: unregisterTask,
            });
          } else {
            blob = await cropAndEnhanceImageBlob(source, rect, upscaleFactor, 0.65, exportFormat);
          }
          const cropExt = exportFormat.toLowerCase();
          return {
            blob,
            filename: buildCropFilename(rect, upscaleFactor, cropRects.length > 1 ? index + 1 : undefined).replace(/\.png$/, "." + cropExt),
            rect,
          };
        }),
      );
      const failedFile = settledFiles.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failedFile) throw failedFile.reason;
      const files = settledFiles.map(
        (result) => (result as PromiseFulfilledResult<{
          blob: Blob;
          filename: string;
          rect: (typeof cropRects)[number];
        }>).value,
      );
      const lastFile = files[files.length - 1];
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(lastFile.blob));
      setResultFilename(lastFile.filename);
      downloadBlobs(files.map(({ blob, filename }) => ({ blob, filename })), downloadBlob);
      const size = calculateCropOutputSize(lastFile.rect, upscaleFactor);
      setStatus(`已下载 ${files.length} 张，最后 ${size.width} x ${size.height}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "切图失败");
    } finally {
      setBusy(false);
    }
  }

  async function redrawWithPrompt() {
    const activeMask = useStore.getState().mask;
    if (!image || !activeMask) return;
    if (!hasPaintedPixels(activeMask)) {
      setStatus("请先绘制或生成 Mask");
      return;
    }
    const activePrompt = prompt.trim();
    if (!activePrompt) {
      setStatus("请输入重绘提示词");
      return;
    }

    setBusy(true);
    setStatus("提示词重绘处理中");
    try {
      const maskBlob = await maskToPngBlob(activeMask);
      const result = await promptInpaintImage({
        image: image.file,
        mask: maskBlob,
        prompt: activePrompt,
        onProgress: setStatus,
        onTaskSubmitted: (taskId) => registerTask(taskId, "提示词重绘"),
        onTaskProgress: updateTask,
        onTaskSettled: unregisterTask,
      });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(result));
      setResultFilename("prompt-inpaint.png");
      setStatus("提示词重绘完成");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "提示词重绘失败");
    } finally {
      setBusy(false);
    }
  }

  return {
    repairImage,
    makeBackgroundTransparent,
    enhanceResolution,
    cropAndDownload,
    redrawWithPrompt,
  };
}
