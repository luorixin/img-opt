import { Activity, Cpu, ImagePlus, MonitorCheck, Sparkles } from "lucide-react";
import { useState } from "react";

import { ResultPane } from "./components/ResultPane";
import { Toolbar } from "./components/Toolbar";
import { Modal } from "./components/Modal";
import { Progress } from "./components/Progress";
import { TaskCenter } from "./components/TaskCenter";
import { hasPaintedPixels } from "./utils/mask";
import { firstImageFile } from "./utils/fileSelection";
import { useStore } from "./store/useStore";
import { useShortcut } from "./hooks/useShortcut";
import { useCanvasDrawing } from "./hooks/useCanvasDrawing";
import { useTaskPolling } from "./hooks/useTaskPolling";
import { useBatchActions } from "./hooks/useBatchActions";
import { useImageActions } from "./hooks/useImageActions";
import { useImageWorkspace } from "./hooks/useImageWorkspace";
import { clearAppState } from "./utils/db";

export default function App() {
  const [isTaskCenterOpen, setIsTaskCenterOpen] = useState(false);

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

  // Subscribe to Zustand state
  const image = useStore((state) => state.image);
  const tool = useStore((state) => state.tool);
  const brushSize = useStore((state) => state.brushSize);
  const maskDilate = useStore((state) => state.maskDilate);
  const maskBlur = useStore((state) => state.maskBlur);
  const backgroundTolerance = useStore((state) => state.backgroundTolerance);
  const upscaleFactor = useStore((state) => state.upscaleFactor);
  const prompt = useStore((state) => state.prompt);
  const algoMode = useStore((state) => state.algoMode);
  // 新增：从 Zustand store 中获取当前选中的导出图像格式 (WEBP, PNG, JPEG)
  const exportFormat = useStore((state) => state.exportFormat);
  const resultUrl = useStore((state) => state.resultUrl);
  const resultFilename = useStore((state) => state.resultFilename);
  const status = useStore((state) => state.status);
  const busy = useStore((state) => state.busy);
  const draggingUpload = useStore((state) => state.draggingUpload);
  const historyTick = useStore((state) => state.historyTick);
  const cropRects = useStore((state) => state.cropRects);
  const historyStack = useStore((state) => state.historyStack);
  const redoStack = useStore((state) => state.redoStack);
  const batchProgress = useStore((state) => state.batchProgress);

  // Zoom & Pan
  const zoom = useStore((state) => state.zoom);
  const panX = useStore((state) => state.panX);
  const panY = useStore((state) => state.panY);
  const spacePressed = useStore((state) => state.spacePressed);
  const isPanning = useStore((state) => state.isPanning);

  // Store Actions
  const setTool = useStore((state) => state.setTool);
  const setBrushSize = useStore((state) => state.setBrushSize);
  const setMaskDilate = useStore((state) => state.setMaskDilate);
  const setMaskBlur = useStore((state) => state.setMaskBlur);
  const setBackgroundTolerance = useStore((state) => state.setBackgroundTolerance);
  const setUpscaleFactor = useStore((state) => state.setUpscaleFactor);
  const setAlgoMode = useStore((state) => state.setAlgoMode);
  // 新增：从 Zustand store 中获取修改导出图像格式的 Action
  const setExportFormat = useStore((state) => state.setExportFormat);
  const setPrompt = useStore((state) => state.setPrompt);
  const undo = useStore((state) => state.undo);
  const redoAction = useStore((state) => state.redo);
  const clearMask = useStore((state) => state.clearMask);
  const clearCropRects = useStore((state) => state.clearCropRects);
  const resetZoomPan = useStore((state) => state.resetZoomPan);

  // Custom Hooks for Workflow
  const {
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
  } = useImageWorkspace();

  const {
    activeTaskIds,
    taskRecords,
    registerTask,
    updateTask,
    unregisterTask,
    cancelActiveTasks,
    clearSettledTasks,
  } = useTaskPolling(reloadOverlay);

  const {
    repairImage,
    makeBackgroundTransparent,
    enhanceResolution,
    cropAndDownload,
    redrawWithPrompt,
  } = useImageActions(imageElementRef, registerTask, updateTask, unregisterTask);

  const { processBatch } = useBatchActions(registerTask, updateTask, unregisterTask);

  // Derived state
  const canUndo = historyStack.length > 0;
  const canRedo = redoStack.length > 0;
  const hasImage = image !== null;
  const canCrop = cropRects.length > 0;
  const currentMask = useStore.getState().mask;
  const canPromptInpaint = currentMask !== null && hasPaintedPixels(currentMask) && Boolean(prompt);
  const canCancelTask = activeTaskIds.length > 0;

  // clear DB and reset
  const handleClearCache = async () => {
    await clearAppState();
    window.location.reload();
  };

  return (
    <main
      className={`appShell ${draggingUpload ? "dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="topBar" aria-label="系统状态栏">
        <div className="brandMark">
          <span className="brandIcon" aria-hidden="true">
            <Sparkles size={14} />
          </span>
          <strong>PixelForge</strong>
          <span className="brandDivider" aria-hidden="true" />
          <span className="brandVersion">v2.4.1</span>
        </div>
        <div className="systemTelemetry" aria-label="运行状态">
          <span className="telemetryItem telemetryLive">
            <span className="liveDot" aria-hidden="true" />
            GPU 加速
          </span>
          <span className="telemetryItem">
            <Activity size={13} />
            内存 2.1 GB
          </span>
          <span className="telemetryItem">
            <MonitorCheck size={13} />
            就绪
          </span>
          <span className="telemetryItem telemetryCompact">
            <Cpu size={13} />
          </span>
        </div>
      </header>

      <Toolbar
        tool={tool}
        brushSize={brushSize}
        maskDilate={maskDilate}
        maskBlur={maskBlur}
        backgroundTolerance={backgroundTolerance}
        upscaleFactor={upscaleFactor}
        algoMode={algoMode}
        exportFormat={exportFormat}
        prompt={prompt}
        canUndo={canUndo}
        canRedo={canRedo}
        undoLength={historyStack.length}
        redoLength={redoStack.length}
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
        onAlgoModeChange={setAlgoMode}
        onExportFormatChange={setExportFormat}
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
        canCancelTask={canCancelTask}
        activeTaskCount={activeTaskIds.length}
        taskRecordCount={taskRecords.length}
        onCancelTask={() => void cancelActiveTasks()}
        onOpenTaskCenter={() => setIsTaskCenterOpen(true)}
        onBatchImagesSelected={(operation, files) => void processBatch(operation, files)}
        zoom={zoom}
        onResetZoomPan={resetZoomPan}
        onClearCache={handleClearCache}
      />

      <section className="workspace" aria-label="编辑区">
        <div className="workspacePanel">
          <h2 className="panelTitle">原始图像</h2>
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
                <strong>拖拽或点击选择图片</strong>
                <span>支持 PNG · JPG · WEBP · AVIF · SVG</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => handleFileInput(event.target.files)}
                />
              </label>
            )}
          </div>
        </div>

        <div className="workspaceDivider">
          <button className="dividerBtn" onClick={resetZoomPan} title="重置视图">
            ›
          </button>
        </div>

        <div className="workspacePanel">
          <h2 className="panelTitle">处理结果</h2>
          <div className="resultStage">
            <ResultPane
              originalUrl={image?.url ?? null}
              resultUrl={resultUrl}
              imageWidth={image?.width}
              imageHeight={image?.height}
            />
          </div>
        </div>
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

      <Modal
        isOpen={isTaskCenterOpen}
        title="后台任务中心"
        footer={
          <button className="primaryButton" onClick={() => setIsTaskCenterOpen(false)}>
            关闭
          </button>
        }
      >
        <TaskCenter
          records={taskRecords}
          canCancelTask={canCancelTask}
          onCancelActive={() => void cancelActiveTasks()}
          onClearSettled={clearSettledTasks}
        />
      </Modal>
    </main>
  );
}
