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
const IMAGE_KEY_NAME = "latestImageFile";

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
/**
 * 使用游程编码 (RLE - Run Length Encoding) 压缩蒙版的 Alpha 通道。
 * 蒙版包含极高比例的重复像素（大部分是未涂抹的 0，少量涂抹区域是 255）。
 * 该编码以交替形式存储像素值与连续出现次数：[像素值, 计数, 像素值, 计数...]
 *
 * @param alpha 原始蒙版的一维像素数组
 * @returns 压缩后的 Uint32Array 数组
 */
export function compressMaskRLE(alpha: Uint8ClampedArray): Uint32Array {
  if (alpha.length === 0) return new Uint32Array(0);

  const result: number[] = [];
  let lastVal = alpha[0];
  let count = 1;

  for (let i = 1; i < alpha.length; i++) {
    const val = alpha[i];
    if (val === lastVal && count < 0xffffffff) {
      count++;
    } else {
      result.push(lastVal, count);
      lastVal = val;
      count = 1;
    }
  }
  result.push(lastVal, count);

  return new Uint32Array(result);
}

/**
 * 解压游程编码 (RLE) 压缩的蒙版 Alpha 通道。
 *
 * @param rle 压缩后的 Uint32Array 游程记录
 * @param length 目标解压还原的像素总数 (width * height)
 * @returns 解压还原后的一维蒙版像素数组
 */
export function decompressMaskRLE(rle: Uint32Array, length: number): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(length);
  let idx = 0;

  for (let i = 0; i < rle.length; i += 2) {
    const val = rle[i];
    const count = rle[i + 1];

    if (idx + count > length) {
      alpha.fill(val, idx, length);
      break;
    }
    alpha.fill(val, idx, idx + count);
    idx += count;
  }

  return alpha;
}

/**
 * 本地图片文件缓存元数据，用以比对文件是否发生实质性修改，
 * 避免每次高频蒙版绘制自动保存时，都重复将相同的巨大 Image File 对象写入磁盘。
 */
let lastSavedFile: File | null = null;
let lastSavedFileName: string | null = null;
let lastSavedFileSize: number | null = null;
let lastSavedFileTime: number | null = null;

/** 检查传入的 File 对象是否与最后一次保存的文件不同 */
function hasFileChanged(file: File | null): boolean {
  if (file === null) {
    return lastSavedFileName !== null || lastSavedFileSize !== null;
  }
  return (
    file !== lastSavedFile ||
    file.name !== lastSavedFileName ||
    file.size !== lastSavedFileSize ||
    file.lastModified !== lastSavedFileTime
  );
}

/** 更新本地内存中的图片状态元数据缓存 */
function updateFileCache(file: File | null) {
  lastSavedFile = file;
  lastSavedFileName = file ? file.name : null;
  lastSavedFileSize = file ? file.size : null;
  lastSavedFileTime = file ? file.lastModified : null;
}

/**
 * @typedef {Object} SavedState
 * @description 定义保存在 IndexedDB 中的应用状态结构。
 * @property {File | null} imageFile - 原始上传的图片文件对象（分离存储时，latestState 中此项为 null）
 * @property {Object | null} mask - 蒙版尺寸和 alpha 通道像素数据
 * @property {CropRect[]} cropRects - 用户框选的切图区域数组
 * @property {Object} settings - 笔刷、模糊度、工具选择等控制面板参数
 */
export type SavedState = {
  imageFile: File | null;
  mask: {
    width: number;
    height: number;
    alpha: Uint8ClampedArray; // 还原出的 alpha 数组在导出的结构里为必填
    rle?: Uint32Array; // 新版游程编码压缩后的数组为可选
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
    exportFormat?: "PNG" | "WEBP" | "JPEG";
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
 * 实时保存当前编辑区的完整状态到 IndexedDB 中（主要元数据与图片文件分离存储）
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
    const fileChanged = hasFileChanged(imageFile);

    return new Promise((resolve, reject) => {
      const database = db as IDBDatabase;
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      // 对 mask 数组进行 RLE 游程编码压缩以提升存取速率并缩小体积
      const compressedMask = mask
        ? {
            width: mask.width,
            height: mask.height,
            rle: compressMaskRLE(mask.alpha),
          }
        : null;

      const state = {
        imageFile: null, // 分离存储时，元数据记录中不包含原图 File
        mask: compressedMask,
        cropRects,
        settings,
      };

      let requestError: Error | DOMException | null = null;

      // 1. 保存除 File 外的应用核心状态与设置
      const stateRequest = store.put(state, KEY_NAME);
      stateRequest.onerror = () => {
        if (stateRequest.error?.name === "QuotaExceededError") {
          requestError = new Error("QUOTA_EXCEEDED");
        } else {
          requestError = stateRequest.error;
        }
      };

      // 2. 仅当图片真的改变时（如导入、清空），才更新或删除独立存储的图片 File 条目
      if (fileChanged) {
        if (imageFile === null) {
          const deleteRequest = store.delete(IMAGE_KEY_NAME);
          deleteRequest.onerror = () => {
            requestError = deleteRequest.error;
          };
        } else {
          const imageRequest = store.put(imageFile, IMAGE_KEY_NAME);
          imageRequest.onerror = () => {
            if (imageRequest.error?.name === "QuotaExceededError") {
              requestError = new Error("QUOTA_EXCEEDED");
            } else {
              requestError = imageRequest.error;
            }
          };
        }
      }

      transaction.oncomplete = () => {
        database.close();
        if (fileChanged) {
          updateFileCache(imageFile);
        }
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
 * 从 IndexedDB 中加载上一次保存的工作区状态（支持旧版全量数据向下兼容读取）
 */
export async function loadAppState(): Promise<SavedState | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const database = db as IDBDatabase;
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);

      const stateRequest = store.get(KEY_NAME);
      const imageRequest = store.get(IMAGE_KEY_NAME);

      let stateResult: any = null;
      let imageResult: File | null = null;

      stateRequest.onsuccess = () => {
        stateResult = stateRequest.result ?? null;
      };
      imageRequest.onsuccess = () => {
        imageResult = imageRequest.result ?? null;
      };

      transaction.oncomplete = () => {
        database.close();
        if (!stateResult) {
          resolve(null);
          return;
        }

        // 兼容解压缩 Mask 蒙版：支持游程压缩数据还原，亦向下兼容老版未压缩的 alpha 数组
        let restoredMask: MaskData | null = null;
        if (stateResult.mask) {
          const { width, height, alpha, rle } = stateResult.mask;
          if (rle) {
            restoredMask = {
              width,
              height,
              alpha: decompressMaskRLE(rle, width * height),
            };
          } else if (alpha) {
            restoredMask = { width, height, alpha };
          }
        }

        // 兼容获取主图文件：旧版 imageFile 存在于 stateResult 内部，新版则读自独立的 imageResult
        const finalImageFile = stateResult.imageFile ?? imageResult;

        // 加载成功后立即同步内存文件缓存，避免后续无改变的重写
        updateFileCache(finalImageFile);

        const savedState: SavedState = {
          imageFile: finalImageFile,
          mask: restoredMask,
          cropRects: stateResult.cropRects || [],
          settings: stateResult.settings,
        };
        resolve(savedState);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
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

      const stateRequest = store.delete(KEY_NAME);
      const imageRequest = store.delete(IMAGE_KEY_NAME);

      transaction.oncomplete = () => {
        database.close();
        updateFileCache(null); // 重置本地缓存
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    db?.close();
    console.error("清除 IndexedDB 状态缓存失败", error);
  }
}
