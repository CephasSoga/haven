import { AlertCircle, ReceiptText, RefreshCw } from "lucide-react";
import { swatch } from "@/lib/utils";
import type { Block } from "./plan";

/** Marks a bill (receipt) or subscription renewal (arrows) on the calendar; overdue bills get a warning. */
export function MoneyIcon({ block }: { block: Block }) {
  const Icon = block.overdue ? AlertCircle : block.kind === "bill" ? ReceiptText : RefreshCw;
  return <Icon className="size-3 shrink-0" style={{ color: block.overdue ? "var(--neg)" : swatch(block.color).fg }} />;
}
