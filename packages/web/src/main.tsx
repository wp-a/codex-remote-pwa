import React from "react";
import ReactDOM from "react-dom/client";
import { useState } from "react";

import { createApiClient } from "./api.js";
import { App } from "./app.js";
import { inferDefaultConnectionToken } from "./connection.js";
import { createRealtimeClient } from "./realtime.js";
import "./styles.css";

type ConnectionConfig = {
  baseUrl: string;
  token: string;
};

function loadConnectionConfig(): ConnectionConfig {
  const baseUrl =
    window.localStorage.getItem("codex-remote.origin") ?? window.location.origin;
  const storedToken = window.localStorage.getItem("codex-remote.token");

  return {
    baseUrl,
    token:
      storedToken ??
      inferDefaultConnectionToken(baseUrl, window.location.origin) ??
      "",
  };
}

async function clearStaleClientCache() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  if ("caches" in window) {
    const cacheKeys = await window.caches.keys();
    await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
  }
}

void clearStaleClientCache().catch(() => undefined);

function Root() {
  const [config, setConfig] = useState<ConnectionConfig>(loadConnectionConfig);

  const client = createApiClient({
    baseUrl: config.baseUrl,
    token: config.token,
  });

  const realtime = createRealtimeClient({
    wsBaseUrl: config.baseUrl.replace(/^http/, "ws"),
    token: config.token,
  });

  return (
    <App
      client={client}
      initialBaseUrl={config.baseUrl}
      initialToken={config.token}
      key={`${config.baseUrl}:${config.token}`}
      onSaveConnection={(nextConfig) => {
        window.localStorage.setItem("codex-remote.origin", nextConfig.baseUrl);
        window.localStorage.setItem("codex-remote.token", nextConfig.token);
        setConfig(nextConfig);
      }}
      realtime={realtime}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
