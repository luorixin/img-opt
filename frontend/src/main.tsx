import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { configureServiceWorker } from "./serviceWorker";
import "./styles/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  void configureServiceWorker(import.meta.env.PROD, {
    register: (scriptUrl) => navigator.serviceWorker.register(scriptUrl),
    getRegistrations: () => navigator.serviceWorker.getRegistrations(),
    getCacheKeys: () => ("caches" in window ? caches.keys() : Promise.resolve([])),
    deleteCache: (key) => caches.delete(key),
    onWindowLoad: (callback) => window.addEventListener("load", callback),
  });
}
