import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/cn";

/** Hvitt kort med runde hjørner og myk skygge (design A). */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-card bg-white p-6 shadow-card ring-1 ring-slate-200/60", className)}
      {...props}
    />
  );
}
