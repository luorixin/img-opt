/**
 * @module Toolbar
 * @description 图像编辑器的工具选择、参数调节、任务操作与批量入口组件。
 */

import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";
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
  exportFormat: "PNG" | "WEBP" | "JPEG";
  prompt: string;
  canUndo: boolean;
  canRedo: boolean;
  undoLength: number;
  redoLength: number;
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
  onExportFormatChange: (format: "PNG" | "WEBP" | "JPEG") => void;
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
  exportFormat,
  prompt,
  canUndo,
  canRedo,
  undoLength,
  redoLength,
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
  onExportFormatChange,
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
  const [isShortcutOpen, setIsShortcutOpen] = useState(false);

  return (
    <>
      <aside className="sidebar" aria-label="工具栏">
        <h2 className="sidebarTitle">工具</h2>
        
        <h3 className="sidebarSubtitle">算法模式</h3>
        <div className="modeGrid">
          <button
            type="button"
            className={`modeToggleBtn sketch-box ${algoMode === "fast" ? "active" : ""}`}
            onClick={() => onAlgoModeChange("fast")}
          >
            <span>快速模式</span>
          </button>
          <button
            type="button"
            className={`modeToggleBtn sketch-box ${algoMode === "ai" ? "active" : ""}`}
            onClick={() => onAlgoModeChange("ai")}
          >
            <span>AI 模式</span>
          </button>
        </div>

        <h3 className="sidebarSubtitle">导出格式</h3>
        <div className="exportGrid">
          <button
            type="button"
            className={`modeToggleBtn sketch-box ${exportFormat === "WEBP" ? "active" : ""}`}
            onClick={() => onExportFormatChange("WEBP")}
          >
            WEBP
          </button>
          <button
            type="button"
            className={`modeToggleBtn sketch-box ${exportFormat === "PNG" ? "active" : ""}`}
            onClick={() => onExportFormatChange("PNG")}
          >
            PNG
          </button>
          <button
            type="button"
            className={`modeToggleBtn sketch-box ${exportFormat === "JPEG" ? "active" : ""}`}
            onClick={() => onExportFormatChange("JPEG")}
          >
            JPEG
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
          <IconButton title={`撤销 (当前有 ${undoLength} 步历史)`} disabled={!canUndo} onClick={onUndo}>
            <div className="iconWithBadge">
              <Undo2 size={18} />
              {undoLength > 0 && <span className="historyBadge">{undoLength}</span>}
            </div>
          </IconButton>
          <IconButton title={`重做 (当前有 ${redoLength} 步可重做)`} disabled={!canRedo} onClick={onRedo}>
            <div className="iconWithBadge">
              <Redo2 size={18} />
              {redoLength > 0 && <span className="historyBadge">{redoLength}</span>}
            </div>
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

        <button
          className="secondaryButton shortcutButton sketch-box"
          type="button"
          onClick={() => setIsShortcutOpen(true)}
          title="键盘快捷键一览"
        >
          <span>快捷键说明</span>
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
          <label className="textControl promptShell sketch-box">
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

      <Modal
        isOpen={isShortcutOpen}
        title="⌨️ 键盘快捷键说明"
        footer={
          <button className="primaryButton" onClick={() => setIsShortcutOpen(false)}>
            我知道了
          </button>
        }
      >
        <div style={{ lineHeight: "1.6" }}>
          <p>在编辑画布上，可以使用以下快捷键提升操作效率：</p>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "10px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd", textAlign: "left" }}>
                <th style={{ padding: "6px" }}>按键</th>
                <th style={{ padding: "6px" }}>功能描述</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px" }}><kbd>Ctrl / Cmd + Z</kbd></td>
                <td style={{ padding: "6px" }}>撤销上一步蒙版绘制</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px" }}><kbd>Ctrl / Cmd + Y</kbd></td>
                <td style={{ padding: "6px" }}>重做撤销的蒙版绘制</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px" }}><kbd>[</kbd></td>
                <td style={{ padding: "6px" }}>减小笔刷大小 (-4)</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px" }}><kbd>]</kbd></td>
                <td style={{ padding: "6px" }}>增大笔刷大小 (+4)</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px" }}><kbd>B</kbd></td>
                <td style={{ padding: "6px" }}>切换至 <strong>画笔</strong> 工具</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px" }}><kbd>E</kbd></td>
                <td style={{ padding: "6px" }}>切换至 <strong>橡皮擦</strong> 工具</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px" }}><kbd>R</kbd></td>
                <td style={{ padding: "6px" }}>切换至 <strong>区域框选</strong> 工具</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px" }}><kbd>C</kbd></td>
                <td style={{ padding: "6px" }}>切换至 <strong>切图区域</strong> 工具</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px" }}><kbd>Space + 拖拽</kbd> / <kbd>中键拖拽</kbd></td>
                <td style={{ padding: "6px" }}>平移画布视图</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Modal>
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
