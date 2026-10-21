import { useCallback, useEffect, useState } from "react";
import { isDesktop } from "@/desktop/runtime";
import { settingsRepository } from "@/persistence/settings";
import type { ModelChoice } from "@/ai/models";

export interface ConnectionSummary {
  available: boolean;
  status: "checking" | "disconnected" | "connecting" | "connected";
  email?: string;
  connectionId?: string;
  models: { id: string; label: string }[];
  error?: string;
}
const EMPTY: ConnectionSummary = { available: false, status: "disconnected", models: [] };
export function useAIConnection() {
  const local =
    import.meta.env.DEV &&
    !isDesktop() &&
    typeof location !== "undefined" &&
    location.hostname === "127.0.0.1";
  const [summary, setSummary] = useState<ConnectionSummary>(
    local ? { ...EMPTY, status: "checking" } : EMPTY,
  );
  const [provider, setProvider] = useState<"anthropic" | "chatgpt">("anthropic");
  const [preferredModel, setPreferredModel] = useState("");
  const [signInUrl, setSignInUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!local) return;
    try {
      const response = await fetch("/__chatgpt/status", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const next = (await response.json()) as ConnectionSummary;
      if (
        !Array.isArray(next.models) ||
        !["connected", "connecting", "disconnected"].includes(next.status)
      )
        throw new Error();
      setSummary(next);
      if (next.status === "connected") setSignInUrl("");
    } catch {
      setSummary({
        ...EMPTY,
        error:
          "Local ChatGPT connection is unavailable. Restart the dev server or use another connection.",
      });
    }
  }, [local]);
  useEffect(() => {
    void settingsRepository.get<string>("ai.connection").then((saved) => {
      if (saved === "chatgpt") setProvider("chatgpt");
    });
    void settingsRepository.get<string>("ai.chatgpt.model").then((saved) => {
      if (saved) setPreferredModel(saved);
    });
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  useEffect(() => {
    if (summary.status !== "connecting") return;
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, [summary.status, refresh]);
  const choose = (next: "anthropic" | "chatgpt") => {
    setProvider(next);
    void settingsRepository.set("ai.connection", next);
  };
  const changeModel = (id: string) => {
    setPreferredModel(id);
    void settingsRepository.set("ai.chatgpt.model", id);
  };
  const connect = async (newAccount = false) => {
    if (busy || !local) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setBusy(true);
    try {
      const response = await fetch("/__chatgpt/connect", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newAccount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start ChatGPT sign-in.");
      const url = new URL(data.url);
      if (url.origin !== "https://auth.openai.com") throw new Error("Invalid sign-in destination.");
      setSignInUrl(url.toString());
      choose("chatgpt");
      setSummary((prev) => ({ ...prev, status: "connecting", error: "" }));
      if (popup) popup.location.href = url.toString();
    } catch (failure) {
      popup?.close();
      setSummary((prev) => ({
        ...prev,
        error: failure instanceof Error ? failure.message : "Could not start ChatGPT sign-in.",
      }));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (busy || !local) return;
    setBusy(true);
    try {
      const response = await fetch("/__chatgpt/disconnect", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Could not disconnect ChatGPT. Try again.");
      setSignInUrl("");
      await refresh();
      // Keep ChatGPT selected. Never switch a subscription user to API billing automatically.
    } catch (failure) {
      setSummary((prev) => ({
        ...prev,
        error: failure instanceof Error ? failure.message : "Could not disconnect.",
      }));
    } finally {
      setBusy(false);
    }
  };
  const models: ModelChoice[] = summary.models.map((model) => ({
    ...model,
    tier: "standard",
    hint: "Uses your connected ChatGPT plan. Availability and usage limits depend on your account.",
  }));
  const modelId = models.some((model) => model.id === preferredModel)
    ? preferredModel
    : (models[0]?.id ?? "chatgpt/unavailable");
  return {
    ...summary,
    provider,
    choose,
    models,
    modelId,
    changeModel,
    connect,
    disconnect,
    refresh,
    signInUrl,
    busy,
  };
}
