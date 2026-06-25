import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildInpaintFormData,
  buildPromptInpaintFormData,
  cancelInpaintTask,
  inpaintImage,
  promptInpaintImage,
  segmentImageMask,
  removeBackground,
  upscaleImage,
} from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api", () => {
  it("builds the multipart payload expected by the backend", () => {
    const image = new File(["image"], "source.png", { type: "image/png" });
    const mask = new Blob(["mask"], { type: "image/png" });

    const formData = buildInpaintFormData({
      image,
      mask,
      maskDilate: 4,
      maskBlur: 2,
    });

    const maskPart = formData.get("mask");

    expect(formData.get("image")).toBe(image);
    expect(maskPart).toBeInstanceOf(File);
    expect((maskPart as File).name).toBe("mask.png");
    expect((maskPart as File).type).toBe("image/png");
    expect((maskPart as File).size).toBe(mask.size);
    expect(formData.get("mask_dilate")).toBe("4");
    expect(formData.get("mask_blur")).toBe("2");
  });

  it("formats structured backend error details for display", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            detail: {
              code: "ENGINE_UNAVAILABLE",
              message: "sidecar offline",
              hint: "Start IOPaint with MPS.",
            },
          }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      inpaintImage({
        image: new File(["image"], "source.png", { type: "image/png" }),
        mask: new Blob(["mask"], { type: "image/png" }),
        maskDilate: 0,
        maskBlur: 0,
      }),
    ).rejects.toThrow("sidecar offline Start IOPaint with MPS.");
  });

  it("polls an async inpaint task until the png result is ready", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: "task-1",
            status: "queued",
            status_url: "/api/tasks/task-1",
            result_url: "/api/tasks/task-1/result",
          }),
          {
            status: 202,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: "task-1",
            state: "PENDING",
            status: "pending",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: "task-1",
            state: "SUCCESS",
            status: "completed",
            result_url: "/api/tasks/task-1/result",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response("png-result", { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await inpaintImage(
      {
        image: new File(["image"], "source.png", { type: "image/png" }),
        mask: new Blob(["mask"], { type: "image/png" }),
        maskDilate: 0,
        maskBlur: 0,
      },
      { pollIntervalMs: 1 },
    );

    expect(await result.text()).toBe("png-result");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8000/api/tasks/task-1", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "http://127.0.0.1:8000/api/tasks/task-1/result", expect.any(Object));
  });

  it("reports backend task progress messages while polling", async () => {
    const onProgress = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "task-1",
              status: "queued",
              status_url: "/api/tasks/task-1",
              result_url: "/api/tasks/task-1/result",
            }),
            { status: 202, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "task-1",
              state: "STARTED",
              status: "running",
              progress: 20,
              message: "Running inpaint",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "task-1",
              state: "SUCCESS",
              status: "completed",
              result_url: "/api/tasks/task-1/result",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(new Response("png-result", { status: 200, headers: { "content-type": "image/png" } })),
    );

    await inpaintImage(
      {
        image: new File(["image"], "source.png", { type: "image/png" }),
        mask: new Blob(["mask"], { type: "image/png" }),
        maskDilate: 0,
        maskBlur: 0,
        onProgress,
      },
      { pollIntervalMs: 1 },
    );

    expect(onProgress).toHaveBeenCalledWith("Running inpaint 20%");
  });

  it("exposes the submitted task id to callers", async () => {
    const onTaskSubmitted = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "task-1",
              status: "queued",
              status_url: "/api/tasks/task-1",
              result_url: "/api/tasks/task-1/result",
            }),
            { status: 202, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "task-1",
              state: "SUCCESS",
              status: "completed",
              result_url: "/api/tasks/task-1/result",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(new Response("png-result", { status: 200, headers: { "content-type": "image/png" } })),
    );

    await inpaintImage(
      {
        image: new File(["image"], "source.png", { type: "image/png" }),
        mask: new Blob(["mask"], { type: "image/png" }),
        maskDilate: 0,
        maskBlur: 0,
        onTaskSubmitted,
      },
      { pollIntervalMs: 1 },
    );

    expect(onTaskSubmitted).toHaveBeenCalledWith("task-1");
  });

  it("notifies callers when an asynchronous task settles", async () => {
    const onTaskSettled = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "task-1",
              status: "queued",
              status_url: "/api/tasks/task-1",
              result_url: "/api/tasks/task-1/result",
            }),
            { status: 202, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "task-1",
              state: "SUCCESS",
              status: "completed",
              result_url: "/api/tasks/task-1/result",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(new Response("png-result", { status: 200 })),
    );

    await inpaintImage(
      {
        image: new File(["image"], "source.png", { type: "image/png" }),
        mask: new Blob(["mask"], { type: "image/png" }),
        maskDilate: 0,
        maskBlur: 0,
        onTaskSettled,
      },
      { pollIntervalMs: 1 },
    );

    expect(onTaskSettled).toHaveBeenCalledWith("task-1");
  });

  it("stops polling when a task is cancelled", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "task-1",
              status: "queued",
              status_url: "/api/tasks/task-1",
              result_url: "/api/tasks/task-1/result",
            }),
            { status: 202, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "task-1",
              state: "REVOKED",
              status: "cancelled",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    );

    await expect(
      inpaintImage(
        {
          image: new File(["image"], "source.png", { type: "image/png" }),
          mask: new Blob(["mask"], { type: "image/png" }),
          maskDilate: 0,
          maskBlur: 0,
        },
        { pollIntervalMs: 1 },
      ),
    ).rejects.toThrow("任务已取消");
  });

  it("submits a task cancellation request", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ task_id: "task-1", status: "cancelled" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await cancelInpaintTask("task-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/tasks/task-1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("submits a point for interactive segmentation", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("mask-png", { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const image = new File(["image"], "source.png", { type: "image/png" });

    const result = await segmentImageMask({ image, x: 12, y: 34 });

    expect(await result.text()).toBe("mask-png");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/segment");
    expect(init.method).toBe("POST");
    const formData = init.body as FormData;
    expect(formData.get("image")).toBe(image);
    expect(formData.get("x")).toBe("12");
    expect(formData.get("y")).toBe("34");
    expect(formData.get("label")).toBe("1");
  });

  it("builds a prompt inpaint payload with diffusion defaults", () => {
    const image = new File(["image"], "source.png", { type: "image/png" });
    const mask = new Blob(["mask"], { type: "image/png" });

    const formData = buildPromptInpaintFormData({
      image,
      mask,
      prompt: "replace with a cat",
    });

    expect(formData.get("image")).toBe(image);
    expect(formData.get("prompt")).toBe("replace with a cat");
    expect(formData.get("negative_prompt")).toBe("");
    expect(formData.get("strength")).toBe("0.85");
    expect(formData.get("steps")).toBe("30");
    expect(formData.get("guidance_scale")).toBe("7.5");
    expect(formData.get("seed")).toBe("-1");
  });

  it("returns a synchronous prompt inpaint result", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("generated-png", { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await promptInpaintImage({
      image: new File(["image"], "source.png", { type: "image/png" }),
      mask: new Blob(["mask"], { type: "image/png" }),
      prompt: "replace with a cat",
    });

    expect(await result.text()).toBe("generated-png");
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/prompt-inpaint");
  });

  it("submits a remove background request with the selected format", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("no-bg-png", { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const image = new File(["image"], "source.png", { type: "image/png" });

    const result = await removeBackground({ image, format: "WEBP" });

    expect(await result.text()).toBe("no-bg-png");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/remove-background");
    expect(init.method).toBe("POST");
    const formData = init.body as FormData;
    expect(formData.get("image")).toBe(image);
    expect(formData.get("format")).toBe("WEBP");
  });

  it("submits an upscale request with optional crop coordinates and format", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("upscaled-png", { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const image = new File(["image"], "source.png", { type: "image/png" });

    const result = await upscaleImage({ image, upscaleFactor: 3, crop: "10,20,30,40", format: "JPEG" });

    expect(await result.text()).toBe("upscaled-png");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/upscale");
    expect(init.method).toBe("POST");
    const formData = init.body as FormData;
    expect(formData.get("image")).toBe(image);
    expect(formData.get("upscale_factor")).toBe("3");
    expect(formData.get("crop")).toBe("10,20,30,40");
    expect(formData.get("format")).toBe("JPEG");
  });
});
