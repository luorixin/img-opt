import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

import { inpaintImage, promptInpaintImage, segmentImageMask } from "./api/api";
import {
  cropAndEnhanceImageBlob,
  imageToEnhancedResolutionBlob,
  imageToTransparentBackgroundBlob,
  loadImage,
  maskToPngBlob,
  pngBlobToMaskData,
  downscaleImageFile,
} from "./utils/canvasExport";
import { ResultPane } from "./components/ResultPane";
import { Toolbar } from "./components/Toolbar";
import { Modal } from "./components/Modal";
import { Progress } from "./components/Progress";
import {
  buildCropFilename,
  calculateCropOutputSize,
  downloadBlob,
  downloadBlobs,
} from "./utils/crop";
import {
  createBlankMask,
  hasPaintedPixels,
  mergeMasks,
  type MaskData,
} from "./utils/mask";
import { firstImageFile, hasDraggedFiles, imageFiles } from "./utils/fileSelection";
import { processBatchImages, type BatchImageOperation } from "./utils/batchProcessing";
import { useStore } from "./store/useStore";
import { useShortcut } from "./hooks/useShortcut";
import { useCanvasDrawing } from "./hooks/useCanvasDrawing";
import { loadAppState } from "./utils/db";

export default function App() {
  // Bind global hotkeys (Undo, Redo, Brush adjust, Tool selector)
  useShortcut();

  // Setup refs, drawing pointer events, offscreen canvas cache, and paint schedule
  const {
    baseCanvasRef,
    overlayCanvasRef,
    imageElementRef,
    pointerEvents,
    reloadOverlay,
  } = useCanvasDrawing();

  const dragDepthRef = useRef(0);

  // Subscribe to Zustand state
  const image = useStore((state) => state.image);
  const tool = useStore((state) => state.tool);
  const brushSize = useStore((state) => state.brushSize);
  const maskDilate = useStore((state) => state.maskDilate);
  const maskBlur = useStore((state) => state.maskBlur);
  const backgroundTolerance = useStore((state) => state.backgroundTolerance);
  const upscaleFactor = useStore((state) => state.upscaleFactor);
  const prompt = useStore((state) => state.prompt);
  const resultUrl = useStore((state) => state.resultUrl);
  const resultFilename = useStore((state) => state.resultFilename);
  const status = useStore((state) => state.status);
  const busy = useStore((state) => state.busy);
  const draggingUpload = useStore((state) => state.draggingUpload);
  const historyTick = useStore((state) => state.historyTick);
  const cropRects = useStore((state) => state.cropRects);
  const historyStack = useStore((state) => state.historyStack);
  const redoStack = useStore((state) => state.redoStack);
  const smartSegmentPoint = useStore((state) => state.smartSegmentPoint);
  const smartSegmentRequestId = useStore((state) => state.smartSegmentRequestId);
  const batchProgress = useStore((state) => state.batchProgress);

  const [pendingLargeImage, setPendingLargeImage] = useState<{ file: File; width: number; height: number } | null>(null);

  // Zoom & Pan
  const zoom = useStore((state) => state.zoom);
  const panX = useStore((state) => state.panX);
  const panY = useStore((state) => state.panY);
  const spacePressed = useStore((state) => state.spacePressed);
  const isPanning = useStore((state) => state.isPanning);

  // Actions
  const setTool = useStore((state) => state.setTool);
  const setBrushSize = useStore((state) => state.setBrushSize);
  const setMaskDilate = useStore((state) => state.setMaskDilate);
  const setMaskBlur = useStore((state) => state.setMaskBlur);
  const setBackgroundTolerance = useStore((state) => state.setBackgroundTolerance);
  const setUpscaleFactor = useStore((state) => state.setUpscaleFactor);
  const setPrompt = useStore((state) => state.setPrompt);
  const setDraggingUpload = useStore((state) => state.setDraggingUpload);
  const undo = useStore((state) => state.undo);
  const redoAction = useStore((state) => state.redo);
  const clearMask = useStore((state) => state.clearMask);
  const clearCropRects = useStore((state) => state.clearCropRects);
  const setStatus = useStore((state) => state.setStatus);
  const setBusy = useStore((state) => state.setBusy);
  const setResultUrl = useStore((state) => state.setResultUrl);
  const setResultFilename = useStore((state) => state.setResultFilename);
  const resetZoomPan = useStore((state) => state.resetZoomPan);
  const setBatchProgress = useStore((state) => state.setBatchProgress);

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

  // Cleanup Object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (image?.url) URL.revokeObjectURL(image.url);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [image?.url, resultUrl]);

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
    if (!source) return;

    setBusy(true);
    setStatus("背景透明处理中");
    try {
      const result = await imageToTransparentBackgroundBlob(source, backgroundTolerance);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(result));
      setResultFilename("transparent-background.png");
      setStatus("透明背景完成");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "透明背景失败");
    } finally {
      setBusy(false);
    }
  }

  async function enhanceResolution() {
    const source = imageElementRef.current;
    if (!source) return;

    setBusy(true);
    setStatus("清晰增强处理中");
    try {
      const result = await imageToEnhancedResolutionBlob(source, upscaleFactor, 0.65);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(result));
      setResultFilename(`enhanced-${upscaleFactor}x.png`);
      setStatus(`${source.naturalWidth * upscaleFactor} x ${source.naturalHeight * upscaleFactor}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "清晰增强失败");
    } finally {
      setBusy(false);
    }
  }

  async function cropAndDownload() {
    const source = imageElementRef.current;
    if (!source || cropRects.length === 0) {
      setStatus("请先框选切图区域");
      return;
    }

    setBusy(true);
    setStatus(`切图处理中，${cropRects.length} 个区域`);
    try {
      const files = await Promise.all(
        cropRects.map(async (rect, index) => ({
          blob: await cropAndEnhanceImageBlob(source, rect, upscaleFactor, 0.65),
          filename: buildCropFilename(rect, upscaleFactor, cropRects.length > 1 ? index + 1 : undefined),
          rect,
        })),
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
        async (source) => {
          if (operation === "transparent") {
            return imageToTransparentBackgroundBlob(source, backgroundTolerance);
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

  const canUndo = historyStack.length > 0;
  const canRedo = redoStack.length > 0;
  const hasImage = image !== null;
  const canCrop = cropRects.length > 0;
  const currentMask = useStore.getState().mask;
  const canPromptInpaint = currentMask !== null && hasPaintedPixels(currentMask);

  return (
    <main
      className={`appShell ${draggingUpload ? "dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Toolbar
        tool={tool}
        brushSize={brushSize}
        maskDilate={maskDilate}
        maskBlur={maskBlur}
        backgroundTolerance={backgroundTolerance}
        upscaleFactor={upscaleFactor}
        prompt={prompt}
        canUndo={canUndo}
        canRedo={canRedo}
        hasImage={hasImage}
        canCrop={canCrop}
        canPromptInpaint={canPromptInpaint}
        busy={busy}
        resultUrl={resultUrl}
        resultFilename={resultFilename}
        status={status}
        historyTick={historyTick}
        onToolChange={setTool}
        onBrushSizeChange={setBrushSize}
        onMaskDilateChange={setMaskDilate}
        onMaskBlurChange={setMaskBlur}
        onBackgroundToleranceChange={setBackgroundTolerance}
        onUpscaleFactorChange={setUpscaleFactor}
        onPromptChange={setPrompt}
        onImageSelected={(file) => void handleImageUpload(firstImageFile(file ? [file] : []))}
        onUndo={undo}
        onRedo={redoAction}
        onClearMask={clearMask}
        onClearCropRects={clearCropRects}
        onReloadOverlay={reloadOverlay}
        onRepair={() => void repairImage()}
        onTransparentBackground={() => void makeBackgroundTransparent()}
        onEnhanceResolution={() => void enhanceResolution()}
        onCropAndDownload={() => void cropAndDownload()}
        onPromptInpaint={() => void redrawWithPrompt()}
        onBatchImagesSelected={(operation, files) => void processBatch(operation, files)}
        zoom={zoom}
        onResetZoomPan={resetZoomPan}
      />

      <section className="workspace" aria-label="编辑区">
        <div className="canvasStage">
          {image ? (
            <div
              className="canvasStack"
              style={{
                aspectRatio: `${image.width} / ${image.height}`,
                transform: `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`,
                transformOrigin: "center",
                transition: isPanning ? "none" : "transform 0.08s ease-out",
              }}
            >
              <canvas ref={baseCanvasRef} className="paintCanvas" />
              <canvas
                ref={overlayCanvasRef}
                className="maskCanvas"
                style={{
                  cursor: isPanning ? "grabbing" : spacePressed ? "grab" : "crosshair",
                }}
                {...pointerEvents}
              />
            </div>
          ) : (
            <label className="emptyDrop">
              <ImagePlus size={34} />
              <span>选择图片</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => handleFileInput(event.target.files)}
              />
            </label>
          )}
        </div>

        <ResultPane resultUrl={resultUrl} />
      </section>

      <Modal
        isOpen={pendingLargeImage !== null}
        title="图片分辨率过大"
        footer={
          <>
            <button className="secondaryButton" onClick={() => setPendingLargeImage(null)}>取消</button>
            <button className="secondaryButton" onClick={() => void acceptOriginal()}>原图继续 (可能崩溃)</button>
            <button className="primaryButton" onClick={() => void acceptDownscale()}>自动缩小 (推荐)</button>
          </>
        }
      >
        <p>
          当前图片尺寸为 <strong>{pendingLargeImage?.width} × {pendingLargeImage?.height}</strong>。
        </p>
        <p>
          过大的分辨率在进行 AI 处理时，极易导致系统显存或内存不足 (OOM) 并引发崩溃。
          建议自动等比例缩放至长边 2048px 以下进行安全处理。
        </p>
      </Modal>

      <Modal
        isOpen={batchProgress !== null}
        title="批量处理中"
      >
        {batchProgress && (
          <Progress
            current={batchProgress.current}
            total={batchProgress.total}
            label={`正在生成${batchProgress.operation}：${batchProgress.filename}`}
          />
        )}
      </Modal>
    </main>
  );
}
