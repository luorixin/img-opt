/**
 * @module Toolbar
 * @description 图像编辑器的工具选择、参数调节、任务操作与批量入口组件。
 */

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
  XCircle,
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
  algoMode: "fast" | "ai";
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
  onAlgoModeChange: (mode: "fast" | "ai") => void;
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
  canCancelTask: boolean;
  onCancelTask: () => void;
  onBatchImagesSelected: (operation: BatchImageOperation, files: FileList | null) => void;
  zoom: number;
  onResetZoomPan: () => void;
  onClearCache: () => void;
};

/** 渲染编辑工具栏与底部操作栏，所有业务动作由父组件注入。 */
export function Toolbar({
  tool,
  brushSize,
  maskDilate,
  maskBlur,
  backgroundTolerance,
  upscaleFactor,
  algoMode,
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
  onAlgoModeChange,
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
  canCancelTask,
  onCancelTask,
  onBatchImagesSelected,
  zoom,
  onResetZoomPan,
  onClearCache,
}: ToolbarProps) {
  return (
    <>
      <aside className="sidebar" aria-label="工具栏">
        <h2 className="sidebarTitle">📄 工具</h2>
        
        <h3 className="sidebarSubtitle" style={{ fontSize: "14px", margin: "8px 0", opacity: 0.8 }}>⚙️ 算法模式</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", marginBottom: "16px" }}>
          <button
            type="button"
            className={`secondaryButton sketch-box ${algoMode === "fast" ? "active" : ""}`}
            style={{
              padding: "6px",
              justifyContent: "center",
              borderColor: algoMode === "fast" ? "#11835f" : undefined,
              background: algoMode === "fast" ? "#eefbf6" : undefined,
            }}
            onClick={() => onAlgoModeChange("fast")}
          >
            <span>快速模式</span>
          </button>
          <button
            type="button"
            className={`secondaryButton sketch-box ${algoMode === "ai" ? "active" : ""}`}
            style={{
              padding: "6px",
              justifyContent: "center",
              borderColor: algoMode === "ai" ? "#11835f" : undefined,
              background: algoMode === "ai" ? "#eefbf6" : undefined,
            }}
            onClick={() => onAlgoModeChange("ai")}
          >
            <span>AI 模式</span>
          </button>
        </div>

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

        <Control label="背景误差" value={backgroundTolerance}>
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

        <button className="secondaryButton sketch-box" disabled={!hasImage || !canCrop || busy} onClick={onClearCropRects}>
          <Trash2 size={18} />
          <span>清空切图</span>
        </button>

        <button className="secondaryButton sketch-box" disabled={!hasImage} onClick={onResetZoomPan}>
          <RotateCcw size={18} />
          <span>重置视图 ({Math.round(zoom * 100)}%)</span>
        </button>

        <button className="secondaryButton sketch-box" onClick={onClearCache} title="如果遇到配额满或异常，可清除本地浏览器存储">
          <Trash2 size={18} />
          <span>清空本地存储</span>
        </button>

        <div className="statusLine">
          <MousePointer2 size={16} />
          <span>{status}</span>
          <span className="historyTick" aria-hidden="true">
            {historyTick}
          </span>
        </div>
      </aside>

      <footer className="bottomBar" aria-label="操作栏">
        <div className="bottomRow">
          <label className="uploadButton sketch-box" title="上传图片">
            <ImagePlus size={18} />
            <span>上传</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => onImageSelected(event.target.files?.[0] ?? null)}
            />
          </label>

          <button className="primaryButton sketch-box" disabled={!hasImage || busy} onClick={onRepair}>
            {busy ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            <span>修复</span>
          </button>

          <button className="secondaryButton sketch-box" disabled={!hasImage || busy} onClick={onTransparentBackground}>
            <ScanLine size={18} />
            <span>透明</span>
          </button>

          <button className="secondaryButton sketch-box" disabled={!hasImage || busy} onClick={onEnhanceResolution}>
            <Maximize2 size={18} />
            <span>清晰</span>
          </button>

          <button className="secondaryButton sketch-box" disabled={!hasImage || busy || !canCrop} onClick={onCropAndDownload}>
            <Crop size={18} />
            <span>切割</span>
          </button>
          
          <button
            className="secondaryButton sketch-box"
            disabled={!hasImage || !canPromptInpaint || !prompt.trim() || busy}
            onClick={onPromptInpaint}
          >
            <Sparkles size={18} />
            <span>重绘</span>
          </button>

          <button className="secondaryButton sketch-box" disabled={!canCancelTask} onClick={onCancelTask}>
            <XCircle size={18} />
            <span>取消任务</span>
          </button>
        </div>

        <div className="bottomRow">
          <label className="textControl sketch-box">
            <input
              className="promptInput"
              type="text"
              value={prompt}
              maxLength={100}
              placeholder="重绘提示词：例如：一只橘猫"
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </label>

          <label className={`secondaryButton batchButton sketch-box ${busy ? "disabled" : ""}`} title="批量透明背景">
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

          <label className={`secondaryButton batchButton sketch-box ${busy ? "disabled" : ""}`} title="批量清晰增强">
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

          <a className={`downloadButton sketch-box ${resultUrl ? "" : "disabled"}`} href={resultUrl ?? undefined} download={resultFilename}>
            <Download size={18} />
            <span>下载</span>
          </a>
        </div>
      </footer>
    </>
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
