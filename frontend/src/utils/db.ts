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

type SaveRequest = {
  imageFile: File | null;
  mask: MaskData | null;
  cropRects: CropRect[];
  settings: SavedState["settings"];
};

type PendingSave<T> = {
  value: T;
  onError?: (error: Error) => void;
};

/**
 * 可串行化的防抖保存队列。
 * 新写入会等待旧写入完成，避免大文件事务完成顺序反转后覆盖较新的工作区状态。
 */
export class DebouncedSaveQueue<T> {
  private pending: PendingSave<T> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly writer: (value: T) => Promise<void>,
    private readonly delayMs: number,
  ) {}

  /** 保存最新快照，并重置防抖计时。 */
  schedule(value: T, onError?: (error: Error) => void): void {
    this.pending = { value, onError };
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.enqueuePending();
    }, this.delayMs);
  }

  /** 立即提交尚未开始的快照，并等待此前所有写入结束。 */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.enqueuePending();
    await this.chain;
  }

  /** 丢弃尚未开始的快照，供清空缓存时阻止旧状态回写。 */
  cancelPending(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  /** 丢弃待写快照，并等待已经开始的事务结束。 */
  async cancelPendingAndWait(): Promise<void> {
    this.cancelPending();
    await this.chain;
  }

  /** 将当前快照接到 Promise 链尾，并在队列内部统一分发错误。 */
  private enqueuePending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.chain = this.chain
      .catch(() => undefined)
      .then(() => this.writer(pending.value))
      .catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        pending.onError?.(normalized);
      });
  }
}

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
    algoMode?: "fast" | "ai";
  };
};

const DB_VERSION = 2;

/**
 * 打开或初始化 IndexedDB 数据库
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1 && !db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      // 后续结构变更应按 oldVersion 依次迁移，避免破坏用户已保存的工作区。
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 实时保存当前编辑区的完整状态到 IndexedDB 中
 */
export async function saveAppState(
  imageFile: File | null,
  mask: MaskData | null,
  cropRects: CropRect[],
  settings: SavedState["settings"]
): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const database = db as IDBDatabase;
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      const state: SavedState = {
        imageFile,
        mask: mask
          ? {
              width: mask.width,
              height: mask.height,
              alpha: mask.alpha,
            }
          : null,
        cropRects,
        settings,
      };

      let requestError: Error | DOMException | null = null;
      const request = store.put(state, KEY_NAME);
      request.onerror = () => {
        if (request.error?.name === "QuotaExceededError") {
          requestError = new Error("QUOTA_EXCEEDED");
        } else {
          requestError = request.error;
        }
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(requestError ?? transaction.error ?? new Error("IndexedDB write failed"));
      };
      transaction.onabort = transaction.onerror;
    });
  } catch (error) {
    db?.close();
    if (error instanceof Error && error.message === "QUOTA_EXCEEDED") {
      throw error; // Re-throw quota errors so UI can show a warning
    }
    console.error("保存应用状态至 IndexedDB 失败", error);
  }
}

const saveQueue = new DebouncedSaveQueue<SaveRequest>(
  ({ imageFile, mask, cropRects, settings }) => saveAppState(imageFile, mask, cropRects, settings),
  1000,
);

export function debouncedSaveAppState(
  imageFile: File | null,
  mask: MaskData | null,
  cropRects: CropRect[],
  settings: SavedState["settings"],
  onError?: (err: Error) => void
): void {
  saveQueue.schedule({ imageFile, mask, cropRects, settings }, onError);
}

/** 立即落盘当前仍处于防抖等待中的工作区快照。 */
export function flushPendingAppState(): Promise<void> {
  return saveQueue.flush();
}

/**
 * 从 IndexedDB 中加载上一次保存的工作区状态
 */
export async function loadAppState(): Promise<SavedState | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const database = db as IDBDatabase;
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(KEY_NAME);
      request.onsuccess = () => {
        database.close();
        resolve(request.result ?? null);
      };
      request.onerror = () => {
        database.close();
        reject(request.error);
      };
    });
  } catch (error) {
    db?.close();
    console.error("从 IndexedDB 加载应用状态失败", error);
    return null;
  }
}

/**
 * 清除 IndexedDB 中保存的缓存状态（用于重置工作区或释放配额）
 */
export async function clearAppState(): Promise<void> {
  await saveQueue.cancelPendingAndWait();
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const database = db as IDBDatabase;
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(KEY_NAME);
      request.onsuccess = () => {
        database.close();
        resolve();
      };
      request.onerror = () => {
        database.close();
        reject(request.error);
      };
    });
  } catch (error) {
    db?.close();
    console.error("清除 IndexedDB 状态缓存失败", error);
  }
}
