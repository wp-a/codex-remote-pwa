export const LOCAL_DEV_TOKEN = "change-me";

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function inferDefaultConnectionToken(
  baseUrl: string,
  fallbackOrigin?: string,
): string | null {
  try {
    const parsed = new URL(baseUrl, fallbackOrigin);
    const tokenFromQuery =
      parsed.searchParams.get("token") ??
      parsed.searchParams.get("bridgeToken");
    if (tokenFromQuery) {
      return tokenFromQuery;
    }

    if (isLoopbackHost(parsed.hostname) && (parsed.port === "" || parsed.port === "8787")) {
      return LOCAL_DEV_TOKEN;
    }

    return null;
  } catch {
    return null;
  }
}

export function buildConnectionLink(
  baseUrl: string,
  token: string,
  fallbackOrigin?: string,
): string | null {
  if (!baseUrl.trim() || !token.trim()) {
    return null;
  }

  try {
    const parsed = new URL(baseUrl, fallbackOrigin);
    parsed.searchParams.delete("bridgeToken");
    parsed.searchParams.set("token", token.trim());
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildRelayConnectionLink(
  relayUrl: string,
  pairCode: string,
  fallbackOrigin?: string,
): string | null {
  if (!relayUrl.trim() || !pairCode.trim()) {
    return null;
  }

  try {
    const parsed = new URL(
      fallbackOrigin ??
        (typeof window === "undefined" ? "http://127.0.0.1:8787/" : window.location.href),
    );
    parsed.searchParams.delete("token");
    parsed.searchParams.set("relay", relayUrl.trim());
    parsed.searchParams.set("pair", pairCode.trim());
    return parsed.toString();
  } catch {
    return null;
  }
}
