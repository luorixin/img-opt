/**
 * @module useImageWorkspace
 * @description 管理图片载入、拖拽/粘贴上传、大图降采样和工作区持久化恢复。
 */

import { useEffect, useRef, useState } from "react";
import { loadImage, downscaleImageFile } from "../utils/canvasExport";
import { createBlankMask, type MaskData } from "../utils/mask";
import { flushPendingAppState, loadAppState } from "../utils/db";
import { firstImageFile, hasDraggedFiles } from "../utils/fileSelection";
import { useStore } from "../store/useStore";

/**
 * 创建图片工作区控制器，统一处理恢复、上传、降采样和拖拽事件。
 */
export function useImageWorkspace() {
  const dragDepthRef = useRef(0);
  const [pendingLargeImage, setPendingLargeImage] = useState<{ file: File; width: number; height: number } | null>(null);

  const image = useStore((state) => state.image);
  const resultUrl = useStore((state) => state.resultUrl);
  const setStatus = useStore((state) => state.setStatus);
  const setBusy = useStore((state) => state.setBusy);
  const setDraggingUpload = useStore((state) => state.setDraggingUpload);

  // Load persistent state from IndexedDB when app mounts
  useEffect(() => {
    async function initFromDB() {
      try {
        const saved = await loadAppState();
        if (!saved || !saved.imageFile) return;

        const { imageFile, mask, cropRects: savedCropRects, settings } = saved;
        const url = URL.createObjectURL(imageFile);
        const loaded = await loadImage(url);

        const loadedMask: MaskData = mask
          ? {
              width: mask.width,
              height: mask.height,
              alpha: mask.alpha,
            }
          : createBlankMask(loaded.naturalWidth, loaded.naturalHeight);

        useStore.setState({
          image: {
            file: imageFile,
            url,
            width: loaded.naturalWidth,
            height: loaded.naturalHeight,
          },
          mask: loadedMask,
          cropRects: savedCropRects || [],
          tool: settings.tool || "rectangle",
          brushSize: settings.brushSize ?? 24,
          maskDilate: settings.maskDilate ?? 4,
          maskBlur: settings.maskBlur ?? 2,
          backgroundTolerance: settings.backgroundTolerance ?? 18,
          upscaleFactor: settings.upscaleFactor ?? 2,
          algoMode: settings.algoMode ?? "fast",
          status: `已载入上次工作区 (${loaded.naturalWidth}x${loaded.naturalHeight})`,
          zoom: 1.0,
          panX: 0,
          panY: 0,
          isPanning: false,
        });
      } catch (error) {
        console.error("Failed to restore saved workspace from IndexedDB", error);
      }
    }
    void initFromDB();
  }, []);

  // 页面进入后台或即将卸载时立即提交防抖快照，降低快速刷新造成的状态丢失。
  useEffect(() => {
    const flush = () => {
      void flushPendingAppState();
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, []);

  // Cleanup Object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (image?.url) URL.revokeObjectURL(image.url);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [image?.url, resultUrl]);

  async function performImageUpload(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const loaded = await loadImage(url);

      // Clean up previous URLs
      if (useStore.getState().image?.url) URL.revokeObjectURL(useStore.getState().image!.url);
      if (useStore.getState().resultUrl) URL.revokeObjectURL(useStore.getState().resultUrl!);

      useStore.setState({
        image: {
          file,
          url,
          width: loaded.naturalWidth,
          height: loaded.naturalHeight,
        },
        mask: createBlankMask(loaded.naturalWidth, loaded.naturalHeight),
        historyStack: [],
        redoStack: [],
        segmentStack: [],
        segmentRedoStack: [],
        resultUrl: null,
        resultFilename: "cleaned.png",
        previewRect: null,
        cropRects: [],
        cropPreview: null,
        status: `${loaded.naturalWidth} x ${loaded.naturalHeight}`,
        zoom: 1.0,
        panX: 0,
        panY: 0,
        isPanning: false,
      });
      useStore.getState().persistToDB();
    } catch (err) {
      console.error(err);
      setStatus("加载图片失败");
    }
  }

  async function handleImageUpload(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("请选择图片文件");
      return;
    }

    const url = URL.createObjectURL(file);
    try {
      const loaded = await loadImage(url);
      const MAX_DIMENSION = 2048;

      if (loaded.naturalWidth > MAX_DIMENSION || loaded.naturalHeight > MAX_DIMENSION) {
        setPendingLargeImage({ file, width: loaded.naturalWidth, height: loaded.naturalHeight });
        URL.revokeObjectURL(url);
        return;
      }

      URL.revokeObjectURL(url);
      await performImageUpload(file);
    } catch (err) {
      console.error(err);
      setStatus("加载图片失败");
    }
  }

  async function acceptDownscale() {
    if (!pendingLargeImage) return;
    setBusy(true);
    try {
      const downscaled = await downscaleImageFile(pendingLargeImage.file, 2048);
      await performImageUpload(downscaled);
    } catch (err) {
      setStatus("降采样失败");
    } finally {
      setBusy(false);
      setPendingLargeImage(null);
    }
  }

  async function acceptOriginal() {
    if (!pendingLargeImage) return;
    await performImageUpload(pendingLargeImage.file);
    setPendingLargeImage(null);
  }

  // Ref helper for pasting handler to capture latest context
  const handleImageUploadRef = useRef(handleImageUpload);
  useEffect(() => {
    handleImageUploadRef.current = handleImageUpload;
  });

  // Clipboard Paste listener
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            event.preventDefault();
            void handleImageUploadRef.current(file);
            break;
          }
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  function handleFileInput(fileList: FileList | null) {
    void handleImageUpload(fileList ? firstImageFile(fileList) : null);
  }

  function handleDragEnter(event: React.DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingUpload(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDraggingUpload(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDraggingUpload(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDraggingUpload(false);
    const file = firstImageFile(event.dataTransfer.files);
    if (!file) {
      setStatus("请拖入图片文件");
      return;
    }
    void handleImageUpload(file);
  }

  return {
    pendingLargeImage,
    setPendingLargeImage,
    handleImageUpload,
    handleFileInput,
    acceptDownscale,
    acceptOriginal,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
