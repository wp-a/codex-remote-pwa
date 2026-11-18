type BridgeServer = {
  on: (
    event: "error",
    listener: (error: NodeJS.ErrnoException) => void,
  ) => unknown;
  listen: (port: number, host: string, callback: () => void) => unknown;
};

type ListenForBridgeOptions = {
  error?: (message: string) => void;
  exit?: (code: number) => void;
  host?: string;
  log?: (message: string) => void;
  port: number;
};

export function listenForBridge(
  server: BridgeServer,
  options: ListenForBridgeOptions,
): void {
  const host = options.host ?? "0.0.0.0";
  const reportError = options.error ?? console.error;
  const exit =
    options.exit ??
    ((code: number) => {
      process.exitCode = code;
    });
  const log = options.log ?? console.log;

  server.on("error", (error) => {
    reportError(
      error.code === "EADDRINUSE"
        ? `Port ${options.port} is already in use. Set PORT to an available port and try again.`
        : `Failed to start codex-remote server: ${error.message}`,
    );
    exit(1);
  });

  server.listen(options.port, host, () => {
    log(`codex-remote server listening on http://${host}:${options.port}`);
  });
}
