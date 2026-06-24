const APP_CACHE_PREFIX = "img-opt-";

type Registration = {
  unregister: () => Promise<boolean>;
};

export type ServiceWorkerRuntime = {
  register: (scriptUrl: string) => Promise<unknown>;
  getRegistrations: () => Promise<readonly Registration[]>;
  getCacheKeys: () => Promise<string[]>;
  deleteCache: (key: string) => Promise<boolean>;
  onWindowLoad: (callback: () => void) => void;
};

export async function configureServiceWorker(
  isProduction: boolean,
  runtime: ServiceWorkerRuntime,
): Promise<void> {
  if (isProduction) {
    runtime.onWindowLoad(() => {
      void runtime.register("/sw.js").catch((error) => {
        console.warn("ServiceWorker registration failed: ", error);
      });
    });
    return;
  }

  const [registrations, cacheKeys] = await Promise.all([
    runtime.getRegistrations(),
    runtime.getCacheKeys(),
  ]);
  await Promise.all([
    ...registrations.map((registration) => registration.unregister()),
    ...cacheKeys
      .filter((key) => key.startsWith(APP_CACHE_PREFIX))
      .map((key) => runtime.deleteCache(key)),
  ]);
}
