import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const toDataURL = vi.hoisted(() => vi.fn());

vi.mock("qrcode", () => ({
  default: { toDataURL },
}));

import { SettingsSheet } from "./settings-sheet.js";

describe("SettingsSheet access candidates", () => {
  it("labels every access kind and sends the preferred Tailscale URL to QR", async () => {
    toDataURL.mockResolvedValue("data:image/png;base64,tailscale");

    render(
      <SettingsSheet
        accessLinks={[
          {
            kind: "local",
            label: "Loopback",
            url: "http://127.0.0.1:8790/?token=secret",
          },
          {
            kind: "current",
            label: "Current",
            url: "https://bridge.example.test/?token=secret",
          },
          {
            kind: "lan",
            label: "Wi-Fi",
            url: "http://192.168.1.20:8790/?token=secret",
          },
          {
            kind: "tailscale",
            label: "Tailnet",
            url: "https://mac.example.ts.net/?token=secret",
          },
        ]}
        baseUrl="https://bridge.example.test"
        connectionMode="direct"
        health={{
          ok: true,
          runtimeMode: "app-server",
          canSendMessages: true,
        }}
        newProjectPath=""
        newTitle=""
        onBaseUrlChange={() => undefined}
        onClose={() => undefined}
        onCopyLink={() => undefined}
        onCreateSession={() => undefined}
        onNewProjectPathChange={() => undefined}
        onNewTitleChange={() => undefined}
        onSaveConnection={() => undefined}
        onTokenChange={() => undefined}
        open
        token="secret"
      />,
    );

    await waitFor(() => {
      expect(toDataURL).toHaveBeenCalledWith(
        "https://mac.example.ts.net/?token=secret",
        expect.any(Object),
      );
    });
    expect(screen.getByText("本机")).toBeInTheDocument();
    expect(screen.getByText("局域网")).toBeInTheDocument();
    expect(screen.getByText("Tailscale")).toBeInTheDocument();
    expect(screen.getByText("当前连接")).toBeInTheDocument();
  });
});
