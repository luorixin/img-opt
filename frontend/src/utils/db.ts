/**
 * @module db
 * @description 提供基于 HTML5 IndexedDB 的本地状态持久化存储。
 * 用于保存用户当前处理的图片、Mask 位图、裁切区域以及工具箱的设置参数，
 * 即使浏览器刷新，也能自动加载并恢复工作区进度。
 */

import type { CropRect } from "./crop";
import type { MaskData } from "./mask";

const DB_NAME = "ImageCleanerDB";
const STORE_NAME = "AppStateStore";
const KEY_NAME = "latestState";

/**
 * @typedef {Object} SavedState
 * @description 定义保存在 IndexedDB 中的应用状态结构。
 * @property {File | null} imageFile - 原始上传的图片文件对象
 * @property {Object | null} mask - 蒙版尺寸和 alpha 通道像素数据
 * @property {CropRect[]} cropRects - 用户框选的切图区域数组
 * @property {Object} settings - 笔刷、模糊度、工具选择等控制面板参数
 */
export type SavedState = {
  imageFile: File | null;
  mask: {
    width: number;
    height: number;
    alpha: Uint8ClampedArray;
  } | null;
  cropRects: CropRect[];
  settings: {
    brushSize: number;
    maskDilate: number;
    maskBlur: number;
    backgroundTolerance: number;
    upscaleFactor: number;
    tool: any; // 选中的工具名称，如 brush, rectangle 等
  };
};

/**
 * 打开或初始化 IndexedDB 数据库
 * @returns {Promise<IDBDatabase>} 返回连接成功的数据库实例
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 实时保存当前编辑区的完整状态到 IndexedDB 中
 * @param {File | null} imageFile - 当前编辑的图片二进制文件
 * @param {MaskData | null} mask - 蒙版数据（包含 Uint8ClampedArray 位图数据）
 * @param {CropRect[]} cropRects - 已框选的切图位置列表
 * @param {SavedState["settings"]} settings - 控制面板上的滑块与工具选项
 * @returns {Promise<void>}
 */
export async function saveAppState(
  imageFile: File | null,
  mask: MaskData | null,
  cropRects: CropRect[],
  settings: SavedState["settings"]
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      const state: SavedState = {
        imageFile,
        mask: mask
          ? {
              width: mask.width,
              height: mask.height,
              alpha: mask.alpha, // 结构化克隆算法 (Structured Clone) 支持直接序列化存储 TypedArray
            }
          : null,
        cropRects,
        settings,
      };

      const request = store.put(state, KEY_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("保存应用状态至 IndexedDB 失败", error);
  }
}

/**
 * 从 IndexedDB 中加载上一次保存的工作区状态
 * @returns {Promise<SavedState | null>} 异步返回保存的状态对象，若无缓存则返回 null
 */
export async function loadAppState(): Promise<SavedState | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(KEY_NAME);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("从 IndexedDB 加载应用状态失败", error);
    return null;
  }
}

/**
 * 清除 IndexedDB 中保存的缓存状态（用于重置工作区）
 * @returns {Promise<void>}
 */
export async function clearAppState(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(KEY_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("清除 IndexedDB 状态缓存失败", error);
  }
}
