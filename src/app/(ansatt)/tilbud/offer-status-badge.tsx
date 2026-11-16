import { Badge } from "@/shared/ui/badge";
import { orderStatusLabel } from "@/core/orders";

type OrderStatus = Parameters<typeof orderStatusLabel>[0];

const tones: Record<OrderStatus, "brand" | "neutral" | "warning"> = {
  received: "brand",
  converted: "neutral",
  rejected: "warning",
};

/** Statusmerket på en ordre. Teksten bærer meningen, fargen er bare hjelp. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={tones[status]}>{orderStatusLabel(status)}</Badge>;
}
