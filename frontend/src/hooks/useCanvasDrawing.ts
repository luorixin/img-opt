/**
 * @module useCanvasDrawing
 * @description 管理画布的核心绘制逻辑与交互逻辑。
 * 包括：
 * 1. 基础图像 Canvas 与蒙版 (Mask) Canvas 的渲染。
 * 2. 离屏 Canvas (Offscreen Canvas) 缓存技术，只有在蒙版更新时做 O(W*H) 循环计算，
 *    鼠标指针滑动绘制选区/切图时使用 O(1) 的 drawImage GPU 硬件加速，提升 4K/8K 超高分辨率图片的流畅度。
 * 3. 结合 requestAnimationFrame 节流控制渲染频率，避免掉帧。
 * 4. 空格键 + 鼠标拖拽 (或鼠标中键拖拽) 实现画布平移 (Pan)，鼠标滚轮实现以光标为中心的原生缩放 (Zoom)。
 */

import { useCallback, useEffect, useRef } from "react";
import { useStore, type PreviewRect } from "../store/useStore";
import { loadImage } from "../utils/canvasExport";
import {
  applyBrushLine,
  applyRectangle,
  mapClientPointToImagePoint,
  type Point,
} from "../utils/mask";
import { normalizeCropRect, type CropRect } from "../utils/crop";

export function useCanvasDrawing() {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const rectStartRef = useRef<Point | null>(null);
  const renderPendingRef = useRef(false);
  const renderOptionsRef = useRef<{
    forceMaskUpdate?: boolean;
    maskRect?: PreviewRect;
    cropRects?: CropRect[];
    cropPreview?: PreviewRect;
  }>({});

  // 拖拽平移 (Panning) 坐标及偏移缓存
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOffsetStartRef = useRef({ x: 0, y: 0 });

  const image = useStore((state) => state.image);
  const previewRect = useStore((state) => state.previewRect);
  const cropRects = useStore((state) => state.cropRects);
  const cropPreview = useStore((state) => state.cropPreview);
  const historyTick = useStore((state) => state.historyTick);

  const setPreviewRect = useStore((state) => state.setPreviewRect);
  const setCropPreview = useStore((state) => state.setCropPreview);
  const setCropRects = useStore((state) => state.setCropRects);
  const pushHistory = useStore((state) => state.pushHistory);
  const incrementHistoryTick = useStore((state) => state.incrementHistoryTick);
  const setStatus = useStore((state) => state.setStatus);

  /**
   * 渲染底部原始图片画布
   */
  const renderBase = useCallback(() => {
    const canvas = baseCanvasRef.current;
    const source = imageElementRef.current;
    const currentImage = useStore.getState().image;
    if (!canvas || !source || !currentImage) return;

    canvas.width = currentImage.width;
    canvas.height = currentImage.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, currentImage.width, currentImage.height);
    context.drawImage(source, 0, 0, currentImage.width, currentImage.height);
  }, []);

  /**
   * 渲染上层蒙版与提示图层画布（使用离屏 Canvas 性能优化）
   */
  const renderOverlay = useCallback((options: {
    forceMaskUpdate?: boolean;
    maskRect?: PreviewRect;
    cropRects?: CropRect[];
    cropPreview?: PreviewRect;
  } = {}) => {
    const canvas = overlayCanvasRef.current;
    const mask = useStore.getState().mask;
    if (!canvas || !mask) return;

    if (canvas.width !== mask.width || canvas.height !== mask.height) {
      canvas.width = mask.width;
      canvas.height = mask.height;
    }

    // 初始化或拉伸离屏 Canvas 缓存
    let offscreen = offscreenCanvasRef.current;
    if (!offscreen) {
      offscreen = document.createElement("canvas");
      offscreenCanvasRef.current = offscreen;
    }
    if (offscreen.width !== mask.width || offscreen.height !== mask.height) {
      offscreen.width = mask.width;
      offscreen.height = mask.height;
      options.forceMaskUpdate = true; // 尺寸不一致时强制重绘
    }

    const offscreenCtx = offscreen.getContext("2d");
    if (!offscreenCtx) return;

    // 只有当蒙版像素发生本质修改时，才执行耗时的 O(W*H) 位图渲染并写入离屏缓存
    if (options.forceMaskUpdate) {
      offscreenCtx.clearRect(0, 0, mask.width, mask.height);
      const pixels = new Uint8ClampedArray(mask.width * mask.height * 4);
      for (let index = 0; index < mask.alpha.length; index += 1) {
        const offset = index * 4;
        pixels[offset] = 255; // 红色通道
        pixels[offset + 1] = 74; // 绿色通道
        pixels[offset + 2] = 93; // 蓝色通道
        pixels[offset + 3] = mask.alpha[index] > 0 ? 118 : 0; // 蒙版半透明度 (alpha=118)
      }
      offscreenCtx.putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, mask.width, mask.height);

    // 1. 以 O(1) 绘制离屏蒙版图层 (GPU 加速)
    context.drawImage(offscreen, 0, 0);

    // 2. 绘制拖拽选区虚线框 (蒙版工具)
    const activePreviewRect = options.maskRect !== undefined ? options.maskRect : useStore.getState().previewRect;
    drawPreviewRect(context, mask.width, activePreviewRect, "#19a974");

    // 3. 绘制已框选的所有切图虚线框与数字序号
    const activeCropRects = options.cropRects !== undefined ? options.cropRects : useStore.getState().cropRects;
    for (let index = 0; index < activeCropRects.length; index += 1) {
      drawCropRect(context, mask.width, activeCropRects[index], index + 1);
    }

    // 4. 绘制当前切图框选预览虚线框
    const activeCropPreview = options.cropPreview !== undefined ? options.cropPreview : useStore.getState().cropPreview;
    drawPreviewRect(context, mask.width, activeCropPreview, "#5b5ce2");
  }, []);

  /**
   * 基于 requestAnimationFrame 节流的 overlay 渲染调度器
   */
  const scheduleRenderOverlay = useCallback((options: {
    forceMaskUpdate?: boolean;
    maskRect?: PreviewRect;
    cropRects?: CropRect[];
    cropPreview?: PreviewRect;
  } = {}) => {
    renderOptionsRef.current = {
      ...renderOptionsRef.current,
      ...options,
      forceMaskUpdate: renderOptionsRef.current.forceMaskUpdate || options.forceMaskUpdate,
    };

    if (renderPendingRef.current) return;
    renderPendingRef.current = true;

    requestAnimationFrame(() => {
      renderPendingRef.current = false;
      const opts = renderOptionsRef.current;
      renderOptionsRef.current = {};
      renderOverlay(opts);
    });
  }, [renderOverlay]);

  // 当图片改变时，异步加载图片并触发初次 Canvas 重绘
  useEffect(() => {
    if (!image) {
      imageElementRef.current = null;
      renderBase();
      return;
    }

    let active = true;
    loadImage(image.url)
      .then((loaded) => {
        if (!active) return;
        imageElementRef.current = loaded;
        renderBase();
        scheduleRenderOverlay({ forceMaskUpdate: true });
      })
      .catch((err) => console.error("Canvas 加载图片资源失败", err));

    return () => {
      active = false;
    };
  }, [image, renderBase, scheduleRenderOverlay]);

  // 监听历史记录步进（强制全画重绘）
  useEffect(() => {
    scheduleRenderOverlay({ forceMaskUpdate: true });
  }, [historyTick, scheduleRenderOverlay]);

  // 监听交互框选等状态改变的轻量重绘
  useEffect(() => {
    scheduleRenderOverlay();
  }, [previewRect, cropRects, cropPreview, scheduleRenderOverlay]);

  // 全局空格键监听，用于激活拖拽平移模式
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        const target = event.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
        event.preventDefault(); // 屏蔽空格滚动页面

        if (!useStore.getState().spacePressed) {
          useStore.setState({ spacePressed: true });
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        useStore.setState({ spacePressed: false, isPanning: false });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // 鼠标滚轮缩放，并以光标所在坐标为缩放中心进行位移修正
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault(); // 拦截页面原生滚动

      const parent = canvas.parentElement; // .canvasStack
      const stage = parent?.parentElement; // .canvasStage
      if (!parent || !stage) return;

      const stageRect = stage.getBoundingClientRect();
      const stageCenterX = stageRect.width / 2;
      const stageCenterY = stageRect.height / 2;

      // 计算鼠标指针相对于编辑区容器几何中心的绝对坐标
      const mx = event.clientX - (stageRect.left + stageCenterX);
      const my = event.clientY - (stageRect.top + stageCenterY);

      const { zoom, panX, panY } = useStore.getState();

      const zoomFactor = 1.08;
      let newZoom = event.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
      // 限制最高/最低缩放范围
      newZoom = Math.min(Math.max(newZoom, 0.15), 24);

      const s = newZoom / zoom;
      const newPanX = mx - (mx - panX) * s;
      const newPanY = my - (my - panY) * s;

      useStore.setState({
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY,
      });
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [image]);

  /**
   * 将屏幕坐标映射为图像坐标
   */
  function pointerToPoint(event: React.PointerEvent<HTMLCanvasElement>): Point | null {
    const canvas = overlayCanvasRef.current;
    const mask = useStore.getState().mask;
    if (!canvas || !mask) return null;
    return mapClientPointToImagePoint(
      event.clientX,
      event.clientY,
      canvas.getBoundingClientRect(),
      mask.width,
      mask.height
    );
  }

  /**
   * 鼠标按压：判定进入拖拽画布模式或启动绘图操作
   */
  const beginStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const spacePressed = useStore.getState().spacePressed;
    const isMiddleClick = event.button === 1;

    // 按住空格或点击中键，激活拖拽平移
    if (spacePressed || isMiddleClick) {
      event.currentTarget.setPointerCapture(event.pointerId);
      useStore.setState({ isPanning: true });
      panStartRef.current = { x: event.clientX, y: event.clientY };
      panOffsetStartRef.current = { x: useStore.getState().panX, y: useStore.getState().panY };
      return;
    }

    const point = pointerToPoint(event);
    const currentMask = useStore.getState().mask;
    if (!point || !currentMask) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = point;

    const currentTool = useStore.getState().tool;

    if (currentTool === "crop") {
      rectStartRef.current = point;
      setCropPreview({ start: point, end: point });
      return;
    }

    if (currentTool === "smart") {
      useStore.getState().setSmartSegmentPoint(point);
      useStore.getState().setSmartSegmentRequestId(useStore.getState().smartSegmentRequestId + 1);
      return;
    }

    pushHistory();

    if (currentTool === "rectangle") {
      rectStartRef.current = point;
      setPreviewRect({ start: point, end: point });
      return;
    }

    const radius = useStore.getState().brushSize / 2;
    const mode = currentTool === "eraser" ? "erase" : "paint";
    applyBrushLine(currentMask, point, point, radius, mode);
    scheduleRenderOverlay({ forceMaskUpdate: true });
  };

  /**
   * 鼠标移动：进行画布拖动或持续更新绘图线段/选区框
   */
  const continueStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const isPanning = useStore.getState().isPanning;

    if (isPanning) {
      const dx = event.clientX - panStartRef.current.x;
      const dy = event.clientY - panStartRef.current.y;
      useStore.setState({
        panX: panOffsetStartRef.current.x + dx,
        panY: panOffsetStartRef.current.y + dy,
      });
      return;
    }

    if (!drawingRef.current) return;
    const currentMask = useStore.getState().mask;
    if (!currentMask) return;
    const point = pointerToPoint(event);
    if (!point) return;

    const currentTool = useStore.getState().tool;

    if (currentTool === "rectangle") {
      const start = rectStartRef.current;
      if (start) setPreviewRect({ start, end: point });
      return;
    }

    if (currentTool === "crop") {
      const start = rectStartRef.current;
      if (start) setCropPreview({ start, end: point });
      return;
    }

    if (currentTool === "smart") {
      return;
    }

    const previous = lastPointRef.current ?? point;
    const radius = useStore.getState().brushSize / 2;
    const mode = currentTool === "eraser" ? "erase" : "paint";
    applyBrushLine(currentMask, previous, point, radius, mode);
    lastPointRef.current = point;
    scheduleRenderOverlay({ forceMaskUpdate: true });
  };

  /**
   * 鼠标抬起：结束拖拽，或将绘图/切图形状应用到状态数据中
   */
  const endStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const isPanning = useStore.getState().isPanning;

    if (isPanning) {
      useStore.setState({ isPanning: false });
      return;
    }

    if (!drawingRef.current) return;
    const currentMask = useStore.getState().mask;
    if (!currentMask) return;
    const point = pointerToPoint(event) ?? lastPointRef.current;

    const currentTool = useStore.getState().tool;
    let nextCropRects = useStore.getState().cropRects;

    if (currentTool === "rectangle" && rectStartRef.current && point) {
      applyRectangle(currentMask, rectStartRef.current, point, "paint");
      scheduleRenderOverlay({ forceMaskUpdate: true });
    }

    if (currentTool === "crop" && rectStartRef.current && point) {
      const rect = normalizeCropRect(rectStartRef.current, point, currentMask.width, currentMask.height);
      if (rect) {
        nextCropRects = [...nextCropRects, rect];
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

    // 每次画笔绘制新线条，重置重做栈
    useStore.setState({ redoStack: [] });
    incrementHistoryTick();
    useStore.getState().persistToDB();
  };

  const reloadOverlay = useCallback(() => {
    scheduleRenderOverlay({ forceMaskUpdate: true });
  }, [scheduleRenderOverlay]);

  return {
    baseCanvasRef,
    overlayCanvasRef,
    imageElementRef,
    pointerEvents: {
      onPointerDown: beginStroke,
      onPointerMove: continueStroke,
      onPointerUp: endStroke,
      onPointerCancel: endStroke,
    },
    reloadOverlay,
  };
}

/**
 * 绘制选择区域预览虚线框 (Rectangle / Crop)
 */
function drawPreviewRect(
  context: CanvasRenderingContext2D,
  imageWidth: number,
  rect: PreviewRect,
  color: string
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

/**
 * 绘制正式的切图区域框和序号标签
 */
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
