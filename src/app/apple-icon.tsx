import { ImageResponse } from "next/og";
import { brand } from "@/shared/config/brand";

// App-ikonet på hjemskjermen i Safari: blå flate med produktnavnets to første bokstaver
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: brand.color,
        color: "#FFFFFF",
        fontSize: 96,
        fontWeight: 700,
      }}
    >
      {brand.productName.slice(0, 2)}
    </div>,
    size,
  );
}
