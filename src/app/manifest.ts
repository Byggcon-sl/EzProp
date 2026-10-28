import type { MetadataRoute } from "next";
import { brand } from "@/shared/config/brand";

/*
 * Webapp-manifest: gjør at appen kan legges på hjemskjermen på iPad og åpnes som en egen app.
 * Filen er ren (ingen database), så testen kan kalle den direkte.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.productName,
    short_name: brand.productName,
    description: `Tilstandsrapporter for takstingeniører i ${brand.companyName}.`,
    lang: "nb",
    start_url: "/arbeidskoe",
    display: "standalone",
    theme_color: brand.color,
    background_color: brand.color,
    icons: [{ src: "/apple-icon", sizes: "180x180", type: "image/png" }],
  };
}
