import React from "react";
import ReactDOM from "react-dom/client";
import { useState } from "react";

import { createApiClient } from "./api.js";
import { App } from "./app.js";
import { inferDefaultConnectionToken } from "./connection.js";
import { createRealtimeClient } from "./realtime.js";
import { createRemoteBridge } from "./remote-bridge.js";
import "./styles.css";

type ConnectionConfig =
  | {
      baseUrl: string;
      mode: "direct";
      token: string;
    }
  | {
      baseUrl: string;
      mode: "relay";
      token: string;
    };

function loadConnectionConfig(): ConnectionConfig {
  const query = new URLSearchParams(window.location.search);
  const relayUrl = query.get("relay") ?? window.localStorage.getItem("codex-remote.relayUrl");
  const pairCode = query.get("pair") ?? window.localStorage.getItem("codex-remote.pairCode");
  if (relayUrl && pairCode) {
    window.localStorage.setItem("codex-remote.mode", "relay");
    window.localStorage.setItem("codex-remote.relayUrl", relayUrl);
    window.localStorage.setItem("codex-remote.pairCode", pairCode);
    return {
      baseUrl: relayUrl,
      mode: "relay",
      token: pairCode,
    };
  }

  if (
    window.localStorage.getItem("codex-remote.mode") === "relay" &&
    relayUrl &&
    pairCode
  ) {
    return {
      baseUrl: relayUrl,
      mode: "relay",
      token: pairCode,
    };
  }

  const baseUrl =
    window.localStorage.getItem("codex-remote.origin") ?? window.location.origin;
  const storedToken = window.localStorage.getItem("codex-remote.token");

  return {
    baseUrl,
    mode: "direct",
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

  const bridge =
    config.mode === "relay"
      ? createRemoteBridge({
          pairCode: config.token,
          relayUrl: config.baseUrl,
        })
      : {
          client: createApiClient({
            baseUrl: config.baseUrl,
            token: config.token,
          }),
          realtime: createRealtimeClient({
            wsBaseUrl: config.baseUrl.replace(/^http/, "ws"),
            token: config.token,
          }),
        };

  return (
    <App
      client={bridge.client}
      connectionMode={config.mode}
      initialBaseUrl={config.baseUrl}
      initialToken={config.token}
      key={`${config.mode}:${config.baseUrl}:${config.token}`}
      onSaveConnection={(nextConfig) => {
        if (config.mode === "relay") {
          window.localStorage.setItem("codex-remote.mode", "relay");
          window.localStorage.setItem("codex-remote.relayUrl", nextConfig.baseUrl);
          window.localStorage.setItem("codex-remote.pairCode", nextConfig.token);
          setConfig({
            baseUrl: nextConfig.baseUrl,
            mode: "relay",
            token: nextConfig.token,
          });
          return;
        }

        window.localStorage.setItem("codex-remote.mode", "direct");
        window.localStorage.setItem("codex-remote.origin", nextConfig.baseUrl);
        window.localStorage.setItem("codex-remote.token", nextConfig.token);
        setConfig({
          baseUrl: nextConfig.baseUrl,
          mode: "direct",
          token: nextConfig.token,
        });
      }}
      realtime={bridge.realtime}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
