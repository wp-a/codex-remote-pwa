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
