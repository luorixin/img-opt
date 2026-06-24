/**
 * @module useStore
 * @description 基于 Zustand 构建的全局应用状态 store。
 * 用来托管所有的 UI 状态、工具选项配置、当前处理图片元数据、已选切图区域以及撤销/重做栈。
 * 同时封装了状态同步持久化到 IndexedDB 的逻辑，是整个应用的状态中枢。
 */

import { create } from "zustand";
import type { Tool } from "../types/types";
import type { CropRect } from "../utils/crop";
import { type MaskData, type Point, cloneMask, createBlankMask } from "../utils/mask";
import { saveAppState } from "../utils/db";

export type ImageState = {
  file: File;
  url: string;
  width: number;
  height: number;
};

export type PreviewRect = {
  start: Point;
  end: Point;
} | null;

interface AppState {
  // === 状态定义 ===
  image: ImageState | null; // 原始图像元数据
  tool: Tool; // 当前选中的工具 (brush | rectangle | eraser | crop)
  brushSize: number; // 笔刷半径大小 (4 - 120)
  maskDilate: number; // 蒙版向外膨胀半径大小 (0 - 32)
  maskBlur: number; // 蒙版边缘羽化半径大小 (0 - 32)
  backgroundTolerance: number; // 背景消除颜色容差 (0 - 80)
  upscaleFactor: number; // 清晰度放大倍率 (2 - 4)
  previewRect: PreviewRect; // 局部涂抹框选框临时数据
  cropRects: CropRect[]; // 已选的切图框选区域列表
  cropPreview: PreviewRect; // 切图选区拉伸预览临时数据
  resultUrl: string | null; // 处理完的图片 Object URL
  resultFilename: string; // 导出的默认文件名
  busy: boolean; // 是否处于网络处理或渲染繁忙状态
  draggingUpload: boolean; // 是否有文件正在画布上方进行拖拽悬停
  status: string; // 左下角状态文本提示
  historyTick: number; // 每次历史栈改动递增的随机刻，用于通知外部重新绘制蒙版

  // 视口缩放与拖拽位移状态
  zoom: number; // 当前缩放比例 (15% - 2400%)
  panX: number; // 视口水平平移量 (px)
  panY: number; // 视口垂直平移量 (px)
  isPanning: boolean; // 当前是否正在拖拽画布平移
  spacePressed: boolean; // 空格键当前是否被按下

  // Prompt & 智能选区状态
  prompt: string;
  smartSegmentPoint: Point | null;
  smartSegmentRequestId: number;

  // 蒙版及撤销/重做队列 (为了不触发大量无效渲染，作为非反应式状态保存在 Store 中，通过 `historyTick` 来间接触发同步)
  mask: MaskData | null;
  historyStack: MaskData[]; // 撤销栈
  redoStack: MaskData[]; // 重做栈

  // === 操作动作 (Actions) ===
  setImage: (image: ImageState | null) => void;
  setTool: (tool: Tool) => void;
  setBrushSize: (size: number) => void;
  setMaskDilate: (dilate: number) => void;
  setMaskBlur: (blur: number) => void;
  setBackgroundTolerance: (tolerance: number) => void;
  setUpscaleFactor: (factor: number) => void;
  setPreviewRect: (rect: PreviewRect) => void;
  setCropRects: (rects: CropRect[]) => void;
  setCropPreview: (rect: PreviewRect) => void;
  setResultUrl: (url: string | null) => void;
  setResultFilename: (filename: string) => void;
  setBusy: (busy: boolean) => void;
  setDraggingUpload: (dragging: boolean) => void;
  setStatus: (status: string) => void;
  incrementHistoryTick: () => void;

  // 视口操作
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetZoomPan: () => void;

  // Prompt & 智能选区 Actions
  setPrompt: (prompt: string) => void;
  setSmartSegmentPoint: (point: Point | null) => void;
  setSmartSegmentRequestId: (id: number) => void;

  // 蒙版像素及历史队列修改
  setMask: (mask: MaskData | null) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  clearMask: () => void;
  clearCropRects: () => void;
  
  // 端侧 IndexedDB 持久化触发接口
  persistToDB: () => void;
}

const MAX_HISTORY = 40;

export const useStore = create<AppState>((set, get) => ({
  // === 初始状态 ===
  image: null,
  tool: "rectangle",
  brushSize: 24,
  maskDilate: 4,
  maskBlur: 2,
  backgroundTolerance: 18,
  upscaleFactor: 2,
  previewRect: null,
  cropRects: [],
  cropPreview: null,
  resultUrl: null,
  resultFilename: "cleaned.png",
  busy: false,
  draggingUpload: false,
  status: "等待图片",
  historyTick: 0,

  zoom: 1.0,
  panX: 0,
  panY: 0,
  isPanning: false,
  spacePressed: false,

  prompt: "",
  smartSegmentPoint: null,
  smartSegmentRequestId: 0,

  mask: null,
  historyStack: [],
  redoStack: [],

  // === 动作行为 ===
  setImage: (image) => {
    set({ image });
    get().persistToDB();
  },
  setTool: (tool) => set({ tool }),
  setBrushSize: (brushSize) => {
    set({ brushSize });
    get().persistToDB();
  },
  setMaskDilate: (maskDilate) => {
    set({ maskDilate });
    get().persistToDB();
  },
  setMaskBlur: (maskBlur) => {
    set({ maskBlur });
    get().persistToDB();
  },
  setBackgroundTolerance: (backgroundTolerance) => {
    set({ backgroundTolerance });
    get().persistToDB();
  },
  setUpscaleFactor: (upscaleFactor) => {
    set({ upscaleFactor });
    get().persistToDB();
  },
  setPreviewRect: (previewRect) => set({ previewRect }),
  setCropRects: (cropRects) => {
    set({ cropRects });
    get().persistToDB();
  },
  setCropPreview: (cropPreview) => set({ cropPreview }),
  setResultUrl: (resultUrl) => set({ resultUrl }),
  setResultFilename: (resultFilename) => set({ resultFilename }),
  setBusy: (busy) => set({ busy }),
  setDraggingUpload: (draggingUpload) => set({ draggingUpload }),
  setStatus: (status) => set({ status }),
  incrementHistoryTick: () => set((state) => ({ historyTick: state.historyTick + 1 })),

  setZoom: (zoom) => set({ zoom }),
  setPan: (panX, panY) => set({ panX, panY }),
  resetZoomPan: () => set({ zoom: 1.0, panX: 0, panY: 0, isPanning: false }),

  setPrompt: (prompt) => set({ prompt }),
  setSmartSegmentPoint: (smartSegmentPoint) => set({ smartSegmentPoint }),
  setSmartSegmentRequestId: (smartSegmentRequestId) => set({ smartSegmentRequestId }),

  setMask: (mask) => {
    set({ mask });
    get().persistToDB();
  },
  pushHistory: () => {
    const { mask, historyStack } = get();
    if (!mask) return;
    set({
      historyStack: [...historyStack.slice(-(MAX_HISTORY - 1)), cloneMask(mask)],
    });
  },
  undo: () => {
    const { mask, historyStack, redoStack } = get();
    if (!mask || historyStack.length === 0) return;
    const previous = historyStack[historyStack.length - 1];
    const nextHistory = historyStack.slice(0, -1);
    const nextRedo = [...redoStack, cloneMask(mask)];
    set((state) => ({
      mask: previous,
      historyStack: nextHistory,
      redoStack: nextRedo,
      historyTick: state.historyTick + 1,
    }));
    get().persistToDB();
  },
  redo: () => {
    const { mask, historyStack, redoStack } = get();
    if (!mask || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const nextRedo = redoStack.slice(0, -1);
    const nextHistory = [...historyStack, cloneMask(mask)];
    set((state) => ({
      mask: next,
      redoStack: nextRedo,
      historyStack: nextHistory,
      historyTick: state.historyTick + 1,
    }));
    get().persistToDB();
  },
  clearMask: () => {
    const { mask } = get();
    if (!mask) return;
    get().pushHistory();
    set((state) => ({
      mask: createBlankMask(mask.width, mask.height),
      redoStack: [],
      historyTick: state.historyTick + 1,
    }));
    get().persistToDB();
  },
  clearCropRects: () => {
    set({ cropRects: [], cropPreview: null, status: "已清空切图区域" });
    get().persistToDB();
  },

  persistToDB: () => {
    const state = get();
    if (state.image) {
      saveAppState(
        state.image.file,
        state.mask,
        state.cropRects,
        {
          brushSize: state.brushSize,
          maskDilate: state.maskDilate,
          maskBlur: state.maskBlur,
          backgroundTolerance: state.backgroundTolerance,
          upscaleFactor: state.upscaleFactor,
          tool: state.tool,
        }
      ).catch((err) => console.error("工作区状态同步至 IndexedDB 异常:", err));
    }
  }
}));
