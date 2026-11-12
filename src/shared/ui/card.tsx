import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/cn";

const tones = {
  default: "border border-line bg-white",
  sand: "bg-sand",
} as const;

/** Kort med tynn kant og 12 px hjørner (Byggcon-profilen). `sand` er flate uten kant. */
export function Card({
  className,
  tone = "default",
  ...props
}: ComponentProps<"div"> & { tone?: keyof typeof tones }) {
  return <div className={cn("rounded-card p-6", tones[tone], className)} {...props} />;
}
