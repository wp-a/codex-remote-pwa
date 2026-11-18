import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const toDataURL = vi.hoisted(() => vi.fn());

vi.mock("qrcode", () => ({
  default: { toDataURL },
}));

import { AccessQr } from "./access-qr.js";

describe("AccessQr", () => {
  it("renders a scannable image generated from the current access URL", async () => {
    toDataURL.mockResolvedValueOnce("data:image/png;base64,current-url");

    render(<AccessQr url="https://mac.example.ts.net/?token=secret" />);

    const image = await screen.findByRole("img", {
      name: "手机访问二维码：https://mac.example.ts.net/?token=secret",
    });
    expect(image).toHaveAttribute("src", "data:image/png;base64,current-url");
    expect(toDataURL).toHaveBeenCalledWith(
      "https://mac.example.ts.net/?token=secret",
      expect.objectContaining({
        errorCorrectionLevel: "M",
        margin: 2,
        width: 192,
      }),
    );
  });

  it("does not let a stale URL generation overwrite the latest QR", async () => {
    let resolveOld: ((value: string) => void) | null = null;
    toDataURL
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce("data:image/png;base64,new-url");

    const { rerender } = render(<AccessQr url="https://old.example.test" />);
    rerender(<AccessQr url="https://new.example.test" />);

    expect(await screen.findByRole("img", { name: /手机访问二维码/ })).toHaveAttribute(
      "src",
      "data:image/png;base64,new-url",
    );

    resolveOld?.("data:image/png;base64,old-url");
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /手机访问二维码/ })).toHaveAttribute(
        "src",
        "data:image/png;base64,new-url",
      );
    });
  });
});
