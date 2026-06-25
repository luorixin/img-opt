/**
 * @module api
 * @description 封装图像处理 HTTP 请求、异步任务轮询和任务取消协议。
 */

export type InpaintRequest = {
  image: File;
  mask: Blob;
  maskDilate: number;
  maskBlur: number;
  onProgress?: (message: string) => void;
  onTaskSubmitted?: (taskId: string) => void;
  onTaskSettled?: (taskId: string) => void;
};

export type InpaintOptions = {
  pollIntervalMs?: number;
  maxPolls?: number;
};

export type SegmentRequest = {
  image: File;
  x: number;
  y: number;
  label?: 0 | 1;
};

export type PromptInpaintRequest = {
  image: File;
  mask: Blob;
  prompt: string;
  negativePrompt?: string;
  strength?: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  onProgress?: (message: string) => void;
  onTaskSubmitted?: (taskId: string) => void;
  onTaskSettled?: (taskId: string) => void;
};

export type RemoveBackgroundRequest = {
  image: File;
  format?: string;
  onProgress?: (message: string) => void;
  onTaskSubmitted?: (taskId: string) => void;
  onTaskSettled?: (taskId: string) => void;
};

export type UpscaleRequest = {
  image: File;
  upscaleFactor: number;
  crop?: string;
  format?: string;
  onProgress?: (message: string) => void;
  onTaskSubmitted?: (taskId: string) => void;
  onTaskSettled?: (taskId: string) => void;
};


const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "";

export function buildInpaintFormData(request: InpaintRequest): FormData {
  const formData = new FormData();
  formData.append("image", request.image);
  formData.append("mask", request.mask, "mask.png");
  formData.append("mask_dilate", String(request.maskDilate));
  formData.append("mask_blur", String(request.maskBlur));
  return formData;
}

export async function inpaintImage(request: InpaintRequest, options: InpaintOptions = {}): Promise<Blob> {
  const response = await apiFetch("/api/inpaint", {
    method: "POST",
    body: buildInpaintFormData(request),
  });

  if (response.status === 202) {
    const task = (await response.json()) as InpaintTaskSubmission;
    request.onTaskSubmitted?.(task.task_id);
    request.onProgress?.("任务已入队");
    return pollInpaintTask(task, request, options);
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Inpainting failed with HTTP ${response.status}`);
  }

  return response.blob();
}

export async function segmentImageMask(request: SegmentRequest): Promise<Blob> {
  const formData = new FormData();
  formData.append("image", request.image);
  formData.append("x", String(request.x));
  formData.append("y", String(request.y));
  formData.append("label", String(request.label ?? 1));

  const response = await apiFetch("/api/segment", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Segmentation failed with HTTP ${response.status}`);
  }
  return response.blob();
}

export function buildPromptInpaintFormData(request: PromptInpaintRequest): FormData {
  const formData = new FormData();
  formData.append("image", request.image);
  formData.append("mask", request.mask, "mask.png");
  formData.append("prompt", request.prompt);
  formData.append("negative_prompt", request.negativePrompt ?? "");
  formData.append("strength", String(request.strength ?? 0.85));
  formData.append("steps", String(request.steps ?? 30));
  formData.append("guidance_scale", String(request.guidanceScale ?? 7.5));
  formData.append("seed", String(request.seed ?? -1));
  return formData;
}

export async function promptInpaintImage(
  request: PromptInpaintRequest,
  options: InpaintOptions = {},
): Promise<Blob> {
  const response = await apiFetch("/api/prompt-inpaint", {
    method: "POST",
    body: buildPromptInpaintFormData(request),
  });

  if (response.status === 202) {
    const task = (await response.json()) as InpaintTaskSubmission;
    request.onTaskSubmitted?.(task.task_id);
    request.onProgress?.("重绘任务已入队");
    return pollInpaintTask(task, request, options);
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Prompt inpainting failed with HTTP ${response.status}`);
  }
  return response.blob();
}

type InpaintTaskSubmission = {
  task_id: string;
  status: string;
  status_url: string;
  result_url: string;
};

type InpaintTaskStatus = {
  task_id: string;
  state: string;
  status: string;
  progress?: number;
  message?: string;
  result_url?: string;
  error?: string;
};

export type CancelTaskResponse = {
  task_id: string;
  status: "cancelled";
};

async function pollInpaintTask(
  task: InpaintTaskSubmission,
  request: {
    onProgress?: (message: string) => void;
    onTaskSettled?: (taskId: string) => void;
  },
  options: InpaintOptions,
): Promise<Blob> {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const maxPolls = options.maxPolls ?? 240;

  try {
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await sleep(pollIntervalMs);
      const response = await apiFetch(task.status_url);
      if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new Error(detail || `Task status failed with HTTP ${response.status}`);
      }

      const status = (await response.json()) as InpaintTaskStatus;
      if (status.status === "completed") {
        request.onProgress?.("任务完成，下载结果中");
        return fetchTaskResult(status.result_url ?? task.result_url);
      }
      if (status.status === "failed") {
        throw new Error(status.error || "修复任务失败");
      }
      if (status.status === "cancelled") {
        throw new Error("任务已取消");
      }
      request.onProgress?.(formatTaskProgress(status));
    }

    throw new Error("修复任务超时");
  } finally {
    request.onTaskSettled?.(task.task_id);
  }
}

async function fetchTaskResult(resultUrl: string): Promise<Blob> {
  const response = await apiFetch(resultUrl);
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Task result failed with HTTP ${response.status}`);
  }
  return response.blob();
}

/** 请求后端取消指定任务；未知或已结束的任务由后端返回明确错误。 */
export async function cancelInpaintTask(taskId: string): Promise<CancelTaskResponse> {
  const response = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Task cancellation failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<CancelTaskResponse>;
}

/** 提交 AI 去背景请求；异步模式下自动轮询并报告任务生命周期。 */
export async function removeBackground(request: RemoveBackgroundRequest, options: InpaintOptions = {}): Promise<Blob> {
  const formData = new FormData();
  formData.append("image", request.image);
  if (request.format) {
    formData.append("format", request.format);
  }

  const response = await apiFetch("/api/remove-background", {
    method: "POST",
    body: formData,
  });

  if (response.status === 202) {
    const task = (await response.json()) as InpaintTaskSubmission;
    request.onTaskSubmitted?.(task.task_id);
    request.onProgress?.("消除背景任务已入队");
    return pollInpaintTask(task, request, options);
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Background removal failed with HTTP ${response.status}`);
  }

  return response.blob();
}

/** 提交 AI 超分请求，并可携带已经过前端归一化的裁剪区域。 */
export async function upscaleImage(request: UpscaleRequest, options: InpaintOptions = {}): Promise<Blob> {
  const formData = new FormData();
  formData.append("image", request.image);
  formData.append("upscale_factor", String(request.upscaleFactor));
  if (request.crop) {
    formData.append("crop", request.crop);
  }
  if (request.format) {
    formData.append("format", request.format);
  }

  const response = await apiFetch("/api/upscale", {
    method: "POST",
    body: formData,
  });

  if (response.status === 202) {
    const task = (await response.json()) as InpaintTaskSubmission;
    request.onTaskSubmitted?.(task.task_id);
    request.onProgress?.("超分任务已入队");
    return pollInpaintTask(task, request, options);
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Upscaling failed with HTTP ${response.status}`);
  }

  return response.blob();
}


async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (API_TOKEN) {
    headers.set("Authorization", `Bearer ${API_TOKEN}`);
  }
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  return fetch(url, { ...init, headers });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function formatTaskStatus(status: string): string {
  return {
    pending: "等待中",
    queued: "排队中",
    running: "处理中",
    retrying: "重试中",
  }[status] ?? status;
}

function formatTaskProgress(status: InpaintTaskStatus): string {
  const label = status.message || `修复任务${formatTaskStatus(status.status)}`;
  return typeof status.progress === "number" ? `${label} ${status.progress}%` : label;
}

async function readErrorDetail(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: unknown };
    return formatDetail(payload.detail);
  }
  return response.text();
}

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (isStructuredDetail(detail)) {
    return [detail.message, detail.hint].filter(Boolean).join(" ");
  }
  return JSON.stringify(detail);
}

function isStructuredDetail(detail: unknown): detail is { message?: string; hint?: string } {
  return typeof detail === "object" && detail !== null && ("message" in detail || "hint" in detail);
}
