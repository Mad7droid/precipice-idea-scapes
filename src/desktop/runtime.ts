import { isTauri } from "@tauri-apps/api/core";

export const isDesktop = () => isTauri();
