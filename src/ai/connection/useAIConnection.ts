import { useCallback, useEffect, useRef, useState } from "react";
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
  profiles?: { id: string; email: string }[];
}
const EMPTY: ConnectionSummary = { available: false, status: "disconnected", models: [] };
export function useAIConnection() {
  const desktop = isDesktop();
  const local =
    import.meta.env.DEV &&
    !isDesktop() &&
    typeof location !== "undefined" &&
    location.hostname === "127.0.0.1";
  const [summary, setSummary] = useState<ConnectionSummary>(
    local ? { ...EMPTY, status: "checking" } : EMPTY,
  );
  const [provider, setProvider] = useState<"anthropic" | "chatgpt" | "claude-plan">("anthropic");
  const [claude, setClaude] = useState<{
    installed: boolean;
    connected: boolean;
    email?: string;
    connectionId?: string;
    error?: string;
  }>({ installed: false, connected: false });
  const [preferredModel, setPreferredModel] = useState("");
  const [signInUrl, setSignInUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [claudeConnecting, setClaudeConnecting] = useState(false);
  const claudeLogin = useRef<string | null>(null);
  const refresh = useCallback(
    async (includeClaude = true) => {
      if (desktop) {
        const { invoke } = await import("@tauri-apps/api/core");
        await Promise.all([
          invoke<ConnectionSummary>("chatgpt_status")
            .then((next) => {
              if (
                !next ||
                !Array.isArray(next.models) ||
                !["connected", "connecting", "disconnected"].includes(next.status)
              )
                throw new Error("Invalid connection summary");
              setSummary(next);
            })
            .catch(() =>
              setSummary({
                ...EMPTY,
                available: true,
                error:
                  "Could not read your ChatGPT connection. Check Keychain access and try again.",
              }),
            ),
          includeClaude
            ? invoke<typeof claude>("claude_status")
                .then((next) => {
                  if (
                    !next ||
                    typeof next.installed !== "boolean" ||
                    typeof next.connected !== "boolean"
                  )
                    throw new Error(
                      "Could not check Claude Code. Update the app and check the connection again.",
                    );
                  setClaude(next);
                })
                .catch((error) =>
                  setClaude({ installed: true, connected: false, error: String(error) }),
                )
            : Promise.resolve(),
        ]);
        return;
      }
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
    },
    [local, desktop],
  );
  useEffect(() => {
    void settingsRepository.get<string>("ai.connection").then((saved) => {
      if (saved === "chatgpt" || saved === "claude-plan") setProvider(saved);
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
    const timer = window.setInterval(() => void refresh(false), 1200);
    return () => window.clearInterval(timer);
  }, [summary.status, refresh]);
  const choose = (next: "anthropic" | "chatgpt" | "claude-plan") => {
    setProvider(next);
    void settingsRepository.set("ai.connection", next);
  };
  const changeModel = (id: string) => {
    setPreferredModel(id);
    void settingsRepository.set("ai.chatgpt.model", id);
  };
  const connect = async (newAccount = false) => {
    if (busy || (!local && !desktop)) return;
    if (desktop) {
      setBusy(true);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("chatgpt_connect", { newAccount });
        choose("chatgpt");
        await refresh();
      } catch (error) {
        setSummary((prev) => ({ ...prev, error: String(error) }));
      } finally {
        setBusy(false);
      }
      return;
    }
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
    if (busy || (!local && !desktop)) return;
    setBusy(true);
    try {
      if (desktop) {
        const { invoke } = await import("@tauri-apps/api/core");
        if (summary.status === "connecting") {
          await invoke("chatgpt_cancel_login");
          await refresh();
          return;
        }
        const result = await invoke<{ revocationConfirmed: boolean }>("chatgpt_disconnect");
        await refresh();
        if (!result.revocationConfirmed)
          setSummary((prev) => ({
            ...prev,
            error:
              "Disconnected on this Mac. Remote revocation could not be confirmed; remove Precipice access in ChatGPT Settings → Usage.",
          }));
        return;
      }
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
  const models: ModelChoice[] =
    provider === "claude-plan"
      ? [
          {
            id: "claude-plan/sonnet",
            label: "Claude Sonnet",
            tier: "standard",
            hint: "Uses your Claude plan through Claude Code. Web search is unavailable.",
          },
          {
            id: "claude-plan/haiku",
            label: "Claude Haiku",
            tier: "instant",
            hint: "Uses your Claude plan through Claude Code.",
          },
          {
            id: "claude-plan/opus",
            label: "Claude Opus",
            tier: "deep",
            hint: "Uses your Claude plan through Claude Code.",
          },
        ]
      : (summary.models.length
          ? summary.models
          : [{ id: "chatgpt/unavailable", label: "Connect ChatGPT" }]
        ).map((model) => ({
          ...model,
          tier: "standard",
          hint: "Uses your connected ChatGPT plan. Availability and usage limits depend on your account.",
        }));
  const modelId = models.some((model) => model.id === preferredModel)
    ? preferredModel
    : (models[0]?.id ?? "chatgpt/unavailable");
  const selectAccount = async (connectionId: string) => {
    if (busy || !desktop) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("chatgpt_select", { connectionId });
      choose("chatgpt");
      await refresh();
    } catch (error) {
      setSummary((prev) => ({ ...prev, error: String(error) }));
    } finally {
      setBusy(false);
    }
  };
  const connectClaude = async () => {
    if (!desktop || claudeConnecting) return;
    setClaudeConnecting(true);
    const id = crypto.randomUUID();
    claudeLogin.current = id;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("claude_connect", { id });
      choose("claude-plan");
      await refresh();
    } catch (error) {
      if (!String(error).includes("cancelled"))
        setClaude((prev) => ({ ...prev, error: String(error) }));
    } finally {
      setClaudeConnecting(false);
      claudeLogin.current = null;
    }
  };
  const cancelClaudeLogin = async () => {
    if (!claudeLogin.current) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ai_cancel", { id: claudeLogin.current }).catch(() => {});
  };
  const openSettings = async (target: "chatgpt-usage" | "claude-usage" | "claude-install") => {
    if (desktop) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("open_ai_settings", { target });
      } catch {
        setSummary((prev) => ({
          ...prev,
          error: "Could not open your browser. Visit ChatGPT or Claude settings to manage usage.",
        }));
      }
    } else window.open("https://chatgpt.com/settings/usage", "_blank", "noopener,noreferrer");
  };
  return {
    ...summary,
    available: summary.available || desktop,
    chatgptStatus: summary.status,
    chatgptConnectionId: summary.connectionId,
    status:
      provider === "claude-plan"
        ? claude.connected
          ? ("connected" as const)
          : ("disconnected" as const)
        : summary.status,
    connectionId:
      provider === "claude-plan" ? (claude.connectionId ?? claude.email) : summary.connectionId,
    desktop,
    claude,
    claudeConnecting,
    connectClaude,
    cancelClaudeLogin,
    openSettings,
    provider,
    choose,
    models,
    modelId,
    changeModel,
    connect,
    disconnect,
    refresh,
    selectAccount,
    signInUrl,
    busy,
  };
}
