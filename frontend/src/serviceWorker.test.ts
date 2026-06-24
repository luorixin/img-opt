import { describe, expect, it, vi } from "vitest";

import { configureServiceWorker } from "./serviceWorker";

describe("service worker configuration", () => {
  it("removes project service workers and caches during development", async () => {
    const unregister = vi.fn(async () => true);
    const deleteCache = vi.fn(async () => true);
    const register = vi.fn();

    await configureServiceWorker(false, {
      register,
      getRegistrations: async () => [{ unregister }],
      getCacheKeys: async () => ["img-opt-v1", "another-app"],
      deleteCache,
      onWindowLoad: vi.fn(),
    });

    expect(unregister).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("img-opt-v1");
    expect(register).not.toHaveBeenCalled();
  });

  it("registers the worker on window load in production", async () => {
    const register = vi.fn(async () => ({}));
    const getRegistrations = vi.fn();
    const deleteCache = vi.fn();

    await configureServiceWorker(true, {
      register,
      getRegistrations,
      getCacheKeys: vi.fn(),
      deleteCache,
      onWindowLoad: (callback) => callback(),
    });

    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(deleteCache).not.toHaveBeenCalled();
  });
});
