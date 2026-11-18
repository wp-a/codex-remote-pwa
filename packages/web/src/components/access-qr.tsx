import { QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type AccessQrProps = {
  url: string;
};

export function AccessQr({ url }: AccessQrProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setDataUrl(null);
    setFailed(false);

    if (!url) {
      return () => {
        active = false;
      };
    }

    void QRCode.toDataURL(url, {
      color: {
        dark: "#17202bff",
        light: "#ffffffff",
      },
      errorCorrectionLevel: "M",
      margin: 2,
      type: "image/png",
      width: 192,
    })
      .then((nextDataUrl) => {
        if (active) {
          setDataUrl(nextDataUrl);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [url]);

  if (!url) {
    return null;
  }

  if (dataUrl) {
    return (
      <div className="access-qr-frame">
        <img
          alt={`手机访问二维码：${url}`}
          className="access-qr"
          height={192}
          src={dataUrl}
          width={192}
        />
      </div>
    );
  }

  return (
    <div
      aria-label={failed ? "二维码生成失败" : "正在生成二维码"}
      aria-live="polite"
      className={`access-qr-frame access-qr-state${failed ? " is-error" : ""}`}
      role="status"
    >
      <QrCode aria-hidden="true" size={44} strokeWidth={1.2} />
    </div>
  );
}
