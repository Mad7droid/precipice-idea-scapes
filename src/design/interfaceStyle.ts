import type { InterfaceStyle } from "@/core/types";

/** This allowlist is mirrored by index.html's synchronous pre-paint script. */
export const INTERFACE_STYLE_MIRROR = "precipice.interfaceStyle";
export const INTERFACE_STYLES: readonly {
  value: InterfaceStyle;
  label: string;
  description: string;
}[] = [
  { value: "current", label: "Current", description: "Warm neutrals and orange accents." },
  { value: "graphite", label: "Graphite", description: "Cool neutrals and mineral green accents." },
  { value: "field", label: "Field", description: "Stone neutrals and violet accents." },
];

export function interfaceStyle(value: unknown): InterfaceStyle {
  return value === "graphite" || value === "field" ? value : "current";
}

export function readInterfaceStyle(): InterfaceStyle {
  try {
    return interfaceStyle(localStorage.getItem(INTERFACE_STYLE_MIRROR));
  } catch {
    return "current";
  }
}

export function applyInterfaceStyle(style: InterfaceStyle): void {
  document.documentElement.dataset.interfaceStyle = interfaceStyle(style);
}
