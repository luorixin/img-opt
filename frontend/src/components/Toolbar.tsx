import type { ReactNode } from "react";
import {
  Brush,
  Download,
  Eraser,
  ImagePlus,
  Crop,
  Loader2,
  Images,
  Maximize2,
  MousePointer2,
  Redo2,
  RotateCcw,
  ScanLine,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
} from "lucide-react";

import type { Tool } from "../types/types";
import type { BatchImageOperation } from "../utils/batchProcessing";

type ToolbarProps = {
  tool: Tool;
  brushSize: number;
  maskDilate: number;
  maskBlur: number;
  backgroundTolerance: number;
  upscaleFactor: number;
  prompt: string;
  canUndo: boolean;
  canRedo: boolean;
  hasImage: boolean;
  canCrop: boolean;
  canPromptInpaint: boolean;
  busy: boolean;
  resultUrl: string | null;
  resultFilename: string;
  status: string;
  historyTick: number;
  onToolChange: (tool: Tool) => void;
  onBrushSizeChange: (value: number) => void;
  onMaskDilateChange: (value: number) => void;
  onMaskBlurChange: (value: number) => void;
  onBackgroundToleranceChange: (value: number) => void;
  onUpscaleFactorChange: (value: number) => void;
  onPromptChange: (value: string) => void;
  onImageSelected: (file: File | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearMask: () => void;
  onClearCropRects: () => void;
  onReloadOverlay: () => void;
  onRepair: () => void;
  onTransparentBackground: () => void;
  onEnhanceResolution: () => void;
  onCropAndDownload: () => void;
  onPromptInpaint: () => void;
  onBatchImagesSelected: (operation: BatchImageOperation, files: FileList | null) => void;
  zoom: number;
  onResetZoomPan: () => void;
};

export function Toolbar({
  tool,
  brushSize,
  maskDilate,
  maskBlur,
  backgroundTolerance,
  upscaleFactor,
  prompt,
  canUndo,
  canRedo,
  hasImage,
  canCrop,
  canPromptInpaint,
  busy,
  resultUrl,
  resultFilename,
  status,
  historyTick,
  onToolChange,
  onBrushSizeChange,
  onMaskDilateChange,
  onMaskBlurChange,
  onBackgroundToleranceChange,
  onUpscaleFactorChange,
  onPromptChange,
  onImageSelected,
  onUndo,
  onRedo,
  onClearMask,
  onClearCropRects,
  onReloadOverlay,
  onRepair,
  onTransparentBackground,
  onEnhanceResolution,
  onCropAndDownload,
  onPromptInpaint,
  onBatchImagesSelected,
  zoom,
  onResetZoomPan,
}: ToolbarProps) {
  return (
    <aside className="toolbar" aria-label="工具栏">
      <label className="uploadButton" title="上传图片">
        <ImagePlus size={18} />
        <span>上传</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => onImageSelected(event.target.files?.[0] ?? null)}
        />
      </label>

      <div className="segmented" role="group" aria-label="选择工具">
        <IconButton active={tool === "brush"} title="画笔" onClick={() => onToolChange("brush")}>
          <Brush size={18} />
        </IconButton>
        <IconButton active={tool === "rectangle"} title="框选" onClick={() => onToolChange("rectangle")}>
          <SquareDashedMousePointer size={18} />
        </IconButton>
        <IconButton active={tool === "smart"} title="智能选区" onClick={() => onToolChange("smart")}>
          <MousePointer2 size={18} />
        </IconButton>
        <IconButton active={tool === "eraser"} title="橡皮擦" onClick={() => onToolChange("eraser")}>
          <Eraser size={18} />
        </IconButton>
        <IconButton active={tool === "crop"} title="切图区域" onClick={() => onToolChange("crop")}>
          <Crop size={18} />
        </IconButton>
      </div>

      <Control label="画笔" value={brushSize}>
        <input
          type="range"
          min="4"
          max="120"
          value={brushSize}
          onChange={(event) => onBrushSizeChange(Number(event.target.value))}
        />
      </Control>

      <Control label="膨胀" value={maskDilate}>
        <input
          type="range"
          min="0"
          max="32"
          value={maskDilate}
          onChange={(event) => onMaskDilateChange(Number(event.target.value))}
        />
      </Control>

      <Control label="羽化" value={maskBlur}>
        <input
          type="range"
          min="0"
          max="32"
          value={maskBlur}
          onChange={(event) => onMaskBlurChange(Number(event.target.value))}
        />
      </Control>

      <Control label="背景容差" value={backgroundTolerance}>
        <input
          type="range"
          min="0"
          max="80"
          value={backgroundTolerance}
          onChange={(event) => onBackgroundToleranceChange(Number(event.target.value))}
        />
      </Control>

      <Control label="清晰倍率" value={upscaleFactor}>
        <input
          type="range"
          min="2"
          max="4"
          step="1"
          value={upscaleFactor}
          onChange={(event) => onUpscaleFactorChange(Number(event.target.value))}
        />
      </Control>

      <div className="iconRow">
        <IconButton title="撤销" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={18} />
        </IconButton>
        <IconButton title="重做" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={18} />
        </IconButton>
        <IconButton title="清空 Mask" disabled={!hasImage} onClick={onClearMask}>
          <Trash2 size={18} />
        </IconButton>
        <IconButton title="重新载入画布" disabled={!hasImage} onClick={onReloadOverlay}>
          <RotateCcw size={18} />
        </IconButton>
      </div>

      <button className="secondaryButton" disabled={!hasImage || !canCrop || busy} onClick={onClearCropRects}>
        <Trash2 size={18} />
        <span>清空切图</span>
      </button>

      <button className="primaryButton" disabled={!hasImage || busy} onClick={onRepair}>
        {busy ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
        <span>修复</span>
      </button>

      <button className="secondaryButton" disabled={!hasImage || busy} onClick={onTransparentBackground}>
        <ScanLine size={18} />
        <span>透明</span>
      </button>

      <button className="secondaryButton" disabled={!hasImage || busy} onClick={onEnhanceResolution}>
        <Maximize2 size={18} />
        <span>清晰</span>
      </button>

      <button className="secondaryButton" disabled={!hasImage || busy || !canCrop} onClick={onCropAndDownload}>
        <Crop size={18} />
        <span>切图</span>
      </button>

      <label className="textControl">
        <span>重绘提示词</span>
        <textarea
          value={prompt}
          maxLength={1000}
          rows={3}
          placeholder="例如：一只橘猫"
          onChange={(event) => onPromptChange(event.target.value)}
        />
      </label>

      <button
        className="secondaryButton"
        disabled={!hasImage || !canPromptInpaint || !prompt.trim() || busy}
        onClick={onPromptInpaint}
      >
        <Sparkles size={18} />
        <span>重绘</span>
      </button>

      <label className={`secondaryButton batchButton ${busy ? "disabled" : ""}`} title="批量透明背景">
        <Images size={18} />
        <span>批量透明</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={busy}
          onChange={(event) => {
            onBatchImagesSelected("transparent", event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>

      <label className={`secondaryButton batchButton ${busy ? "disabled" : ""}`} title="批量清晰增强">
        <Maximize2 size={18} />
        <span>批量清晰</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={busy}
          onChange={(event) => {
            onBatchImagesSelected("enhance", event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>

      <button className="secondaryButton" disabled={!hasImage} onClick={onResetZoomPan}>
        <RotateCcw size={18} />
        <span>重置视图 ({Math.round(zoom * 100)}%)</span>
      </button>

      <a className={`downloadButton ${resultUrl ? "" : "disabled"}`} href={resultUrl ?? undefined} download={resultFilename}>
        <Download size={18} />
        <span>下载</span>
      </a>

      <div className="statusLine">
        <MousePointer2 size={16} />
        <span>{status}</span>
        <span className="historyTick" aria-hidden="true">
          {historyTick}
        </span>
      </div>
    </aside>
  );
}

function IconButton({
  children,
  active = false,
  disabled = false,
  title,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`iconButton ${active ? "active" : ""}`}
      type="button"
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Control({ label, value, children }: { label: string; value: number; children: ReactNode }) {
  return (
    <label className="control">
      <span>
        {label}
        <strong>{value}</strong>
      </span>
      {children}
    </label>
  );
}
