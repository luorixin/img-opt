export type InpaintRequest = {
  image: File;
  mask: Blob;
  maskDilate: number;
  maskBlur: number;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export function buildInpaintFormData(request: InpaintRequest): FormData {
  const formData = new FormData();
  formData.append("image", request.image);
  formData.append("mask", request.mask, "mask.png");
  formData.append("mask_dilate", String(request.maskDilate));
  formData.append("mask_blur", String(request.maskBlur));
  return formData;
}

export async function inpaintImage(request: InpaintRequest): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/inpaint`, {
    method: "POST",
    body: buildInpaintFormData(request),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Inpainting failed with HTTP ${response.status}`);
  }

  return response.blob();
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
