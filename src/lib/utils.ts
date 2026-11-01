import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid() {
  return crypto.randomUUID();
}

/** Palette shared by events, categories and accounts. Each swatch reads well on light and dark. */
export const SWATCHES = [
  { id: "violet", fg: "#7c6cff", soft: "rgb(124 108 255 / 0.14)" },
  { id: "blue", fg: "#3b82f6", soft: "rgb(59 130 246 / 0.14)" },
  { id: "teal", fg: "#1f9e85", soft: "rgb(31 158 133 / 0.15)" },
  { id: "green", fg: "#5aa841", soft: "rgb(90 168 65 / 0.16)" },
  { id: "amber", fg: "#d99a1e", soft: "rgb(217 154 30 / 0.17)" },
  { id: "orange", fg: "#ec7a3c", soft: "rgb(236 122 60 / 0.15)" },
  { id: "rose", fg: "#e0555a", soft: "rgb(224 85 90 / 0.14)" },
  { id: "pink", fg: "#d6589f", soft: "rgb(214 88 159 / 0.14)" },
  { id: "slate", fg: "#7a8394", soft: "rgb(122 131 148 / 0.16)" },
] as const;

export type SwatchId = (typeof SWATCHES)[number]["id"];

export function swatch(id: string) {
  return SWATCHES.find((s) => s.id === id) ?? SWATCHES[0];
}
