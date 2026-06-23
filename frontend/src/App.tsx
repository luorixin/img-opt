import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

import { inpaintImage } from "./api/api";
import {
  cropAndEnhanceImageBlob,
  imageToEnhancedResolutionBlob,
  imageToTransparentBackgroundBlob,
  loadImage,
  maskToPngBlob,
} from "./utils/canvasExport";
import { ResultPane } from "./components/ResultPane";
import { Toolbar } from "./components/Toolbar";
import {
  buildCropFilename,
  calculateCropOutputSize,
  downloadBlob,
  downloadBlobs,
  normalizeCropRect,
  type CropRect,
} from "./utils/crop";
import {
  applyBrushLine,
  applyRectangle,
  cloneMask,
  createBlankMask,
  hasPaintedPixels,
  mapClientPointToImagePoint,
  type MaskData,
  type Point,
} from "./utils/mask";
import { firstImageFile, hasDraggedFiles } from "./utils/fileSelection";
import type { Tool } from "./types/types";

type ImageState = {
  file: File;
  url: string;
  width: number;
  height: number;
};

type PreviewRect = {
  start: Point;
  end: Point;
} | null;

type OverlayState = {
  maskRect: PreviewRect;
  cropRects: CropRect[];
  cropPreview: PreviewRect;
};

const MAX_HISTORY = 40;

export default function App() {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const maskRef = useRef<MaskData | null>(null);
  const historyRef = useRef<MaskData[]>([]);
  const redoRef = useRef<MaskData[]>([]);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const rectStartRef = useRef<Point | null>(null);

  const [image, setImage] = useState<ImageState | null>(null);
  const [tool, setTool] = useState<Tool>("rectangle");
  const [brushSize, setBrushSize] = useState(24);
  const [maskDilate, setMaskDilate] = useState(4);
  const [maskBlur, setMaskBlur] = useState(2);
  const [backgroundTolerance, setBackgroundTolerance] = useState(18);
  const [upscaleFactor, setUpscaleFactor] = useState(2);
  const [previewRect, setPreviewRect] = useState<PreviewRect>(null);
  const [cropRects, setCropRects] = useState<CropRect[]>([]);
  const [cropPreview, setCropPreview] = useState<PreviewRect>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultFilename, setResultFilename] = useState("cleaned.png");
  const [busy, setBusy] = useState(false);
  const [draggingUpload, setDraggingUpload] = useState(false);
  const dragDepthRef = useRef(0);
  const [status, setStatus] = useState("等待图片");
  const [historyTick, setHistoryTick] = useState(0);

  const renderBase = useCallback(() => {
    const canvas = baseCanvasRef.current;
    const source = imageElementRef.current;
    if (!canvas || !source || !image) return;

    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, image.width, image.height);
    context.drawImage(source, 0, 0, image.width, image.height);
  }, [image]);

  const renderOverlay = useCallback((overlay: Partial<OverlayState> = {}) => {
    const canvas = overlayCanvasRef.current;
    const mask = maskRef.current;
    if (!canvas || !mask) return;

    canvas.width = mask.width;
    canvas.height = mask.height;
    const context = canvas.getContext("2d");
    if (!context) return;

    const pixels = new Uint8ClampedArray(mask.width * mask.height * 4);
    for (let index = 0; index < mask.alpha.length; index += 1) {
      const offset = index * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 74;
      pixels[offset + 2] = 93;
      pixels[offset + 3] = mask.alpha[index] > 0 ? 118 : 0;
    }
    context.putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);

    drawPreviewRect(context, mask.width, overlay.maskRect ?? null, "#19a974");

    const crops = overlay.cropRects ?? [];
    for (let index = 0; index < crops.length; index += 1) {
      drawCropRect(context, mask.width, crops[index], index + 1);
    }
    drawPreviewRect(context, mask.width, overlay.cropPreview ?? null, "#5b5ce2");
  }, []);

  useEffect(() => {
    renderBase();
    renderOverlay({ maskRect: previewRect, cropRects, cropPreview });
  }, [cropPreview, cropRects, previewRect, renderBase, renderOverlay]);

  useEffect(() => {
    return () => {
      if (image?.url) URL.revokeObjectURL(image.url);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [image?.url, resultUrl]);

  async function handleImageUpload(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("请选择图片文件");
      return;
    }

    const url = URL.createObjectURL(file);
    const loaded = await loadImage(url);
    if (image?.url) URL.revokeObjectURL(image.url);
    if (resultUrl) URL.revokeObjectURL(resultUrl);

    imageElementRef.current = loaded;
    maskRef.current = createBlankMask(loaded.naturalWidth, loaded.naturalHeight);
    historyRef.current = [];
    redoRef.current = [];
    setHistoryTick((value) => value + 1);
    setResultUrl(null);
    setResultFilename("cleaned.png");
    setPreviewRect(null);
    setCropRects([]);
    setCropPreview(null);
    setImage({
      file,
      url,
      width: loaded.naturalWidth,
      height: loaded.naturalHeight,
    });
    setStatus(`${loaded.naturalWidth} x ${loaded.naturalHeight}`);
  }

  const handleImageUploadRef = useRef(handleImageUpload);
  useEffect(() => {
    handleImageUploadRef.current = handleImageUpload;
  });

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

  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointerToPoint(event);
    if (!point || !maskRef.current) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = point;

    if (tool === "crop") {
      rectStartRef.current = point;
      setCropPreview({ start: point, end: point });
      return;
    }

    pushHistory();

    if (tool === "rectangle") {
      rectStartRef.current = point;
      setPreviewRect({ start: point, end: point });
      return;
    }

    applyBrushLine(maskRef.current, point, point, brushSize / 2, tool === "eraser" ? "erase" : "paint");
    renderOverlay({ cropRects });
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !maskRef.current) return;
    const point = pointerToPoint(event);
    if (!point) return;

    if (tool === "rectangle") {
      const start = rectStartRef.current;
      if (start) setPreviewRect({ start, end: point });
      return;
    }

    if (tool === "crop") {
      const start = rectStartRef.current;
      if (start) setCropPreview({ start, end: point });
      return;
    }

    const previous = lastPointRef.current ?? point;
    applyBrushLine(maskRef.current, previous, point, brushSize / 2, tool === "eraser" ? "erase" : "paint");
    lastPointRef.current = point;
    renderOverlay({ cropRects });
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !maskRef.current) return;
    const point = pointerToPoint(event) ?? lastPointRef.current;
    let nextCropRects = cropRects;

    if (tool === "rectangle" && rectStartRef.current && point) {
      applyRectangle(maskRef.current, rectStartRef.current, point, "paint");
    }

    if (tool === "crop" && rectStartRef.current && point) {
      const rect = normalizeCropRect(rectStartRef.current, point, maskRef.current.width, maskRef.current.height);
      if (rect) {
        nextCropRects = [...cropRects, rect];
        setCropRects(nextCropRects);
        setStatus(`已选 ${nextCropRects.length} 个切图区域，新增 ${rect.width} x ${rect.height}`);
      } else {
        setStatus("切图选区太小");
      }
    }

    drawingRef.current = false;
    lastPointRef.current = null;
    rectStartRef.current = null;
    setPreviewRect(null);
    setCropPreview(null);
    redoRef.current = [];
    setHistoryTick((value) => value + 1);
    renderOverlay({ cropRects: nextCropRects });
  }

  function pointerToPoint(event: React.PointerEvent<HTMLCanvasElement>): Point | null {
    const canvas = overlayCanvasRef.current;
    const mask = maskRef.current;
    if (!canvas || !mask) return null;
    return mapClientPointToImagePoint(
      event.clientX,
      event.clientY,
      canvas.getBoundingClientRect(),
      mask.width,
      mask.height,
    );
  }

  function pushHistory() {
    const mask = maskRef.current;
    if (!mask) return;
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), cloneMask(mask)];
  }

  function undo() {
    const current = maskRef.current;
    const previous = historyRef.current.pop();
    if (!current || !previous) return;
    redoRef.current.push(cloneMask(current));
    maskRef.current = previous;
    setHistoryTick((value) => value + 1);
    renderOverlay({ cropRects });
  }

  function redo() {
    const current = maskRef.current;
    const next = redoRef.current.pop();
    if (!current || !next) return;
    historyRef.current.push(cloneMask(current));
    maskRef.current = next;
    setHistoryTick((value) => value + 1);
    renderOverlay({ cropRects });
  }

  function clearMask() {
    const mask = maskRef.current;
    if (!mask) return;
    pushHistory();
    maskRef.current = createBlankMask(mask.width, mask.height);
    redoRef.current = [];
    setHistoryTick((value) => value + 1);
    renderOverlay({ cropRects });
  }

  function clearCropRects() {
    setCropRects([]);
    setCropPreview(null);
    setStatus("已清空切图区域");
  }

  async function repairImage() {
    const mask = maskRef.current;
    if (!image || !mask) return;
    if (!hasPaintedPixels(mask)) {
      setStatus("Mask 为空");
      return;
    }

    setBusy(true);
    setStatus("修复中");
    try {
      const maskBlob = await maskToPngBlob(mask);
      const result = await inpaintImage({
        image: image.file,
        mask: maskBlob,
        maskDilate,
        maskBlur,
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

  const canUndo = historyRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  const hasImage = image !== null;
  const canCrop = cropRects.length > 0;

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
        canUndo={canUndo}
        canRedo={canRedo}
        hasImage={hasImage}
        canCrop={canCrop}
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
        onImageSelected={(file) => void handleImageUpload(firstImageFile(file ? [file] : []))}
        onUndo={undo}
        onRedo={redo}
        onClearMask={clearMask}
        onClearCropRects={clearCropRects}
        onReloadOverlay={() => renderOverlay({ maskRect: previewRect, cropRects, cropPreview })}
        onRepair={() => void repairImage()}
        onTransparentBackground={() => void makeBackgroundTransparent()}
        onEnhanceResolution={() => void enhanceResolution()}
        onCropAndDownload={() => void cropAndDownload()}
      />

      <section className="workspace" aria-label="编辑区">
        <div className="canvasStage">
          {image ? (
            <div className="canvasStack" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
              <canvas ref={baseCanvasRef} className="paintCanvas" />
              <canvas
                ref={overlayCanvasRef}
                className="maskCanvas"
                onPointerDown={beginStroke}
                onPointerMove={continueStroke}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
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
    </main>
  );
}

function drawPreviewRect(
  context: CanvasRenderingContext2D,
  imageWidth: number,
  rect: PreviewRect,
  color: string,
) {
  if (!rect) return;
  const x = Math.min(rect.start.x, rect.end.x);
  const y = Math.min(rect.start.y, rect.end.y);
  const width = Math.abs(rect.end.x - rect.start.x);
  const height = Math.abs(rect.end.y - rect.start.y);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, Math.round(imageWidth / 600));
  context.setLineDash([10, 6]);
  context.strokeRect(x, y, width, height);
  context.restore();
}

function drawCropRect(context: CanvasRenderingContext2D, imageWidth: number, rect: CropRect, index: number) {
  const lineWidth = Math.max(2, Math.round(imageWidth / 600));
  context.save();
  context.fillStyle = "rgb(91 92 226 / 12%)";
  context.strokeStyle = "#5b5ce2";
  context.lineWidth = lineWidth;
  context.setLineDash([12, 6]);
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.setLineDash([]);
  context.fillStyle = "#5b5ce2";
  context.font = `${Math.max(12, Math.round(imageWidth / 90))}px sans-serif`;
  const label = String(index);
  const metrics = context.measureText(label);
  const labelWidth = Math.ceil(metrics.width + 12);
  const labelHeight = Math.max(18, Math.round(imageWidth / 34));
  context.fillRect(rect.x, Math.max(0, rect.y - labelHeight), labelWidth, labelHeight);
  context.fillStyle = "#ffffff";
  context.fillText(label, rect.x + 6, Math.max(14, rect.y - Math.round(labelHeight * 0.28)));
  context.restore();
}
