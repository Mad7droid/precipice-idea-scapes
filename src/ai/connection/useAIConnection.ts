import { useCallback, useEffect, useRef, useState } from "react";
import { isDesktop } from "@/desktop/runtime";
import { settingsRepository } from "@/persistence/settings";
import {
  availableProviders,
  isProviderId,
  modelsFor,
  PROVIDERS,
  type ProviderId,
} from "./providers";
import { isKeychainDenied } from "@/desktop/keychain";

export interface ConnectionSummary {
  available: boolean;
  status: "checking" | "disconnected" | "connecting" | "connected";
  email?: string;
  connectionId?: string;
  models: { id: string; label: string }[];
  error?: string;
  profiles?: { id: string; email: string }[];
}
export interface ClaudeSummary {
  installed: boolean;
  connected: boolean;
  checked: boolean;
  email?: string;
  connectionId?: string;
  error?: string;
}
const EMPTY: ConnectionSummary = { available: false, status: "disconnected", models: [] };
/** Each Claude check starts a Claude Code process, so focus changes reuse a recent answer. */
const CLAUDE_FOCUS_REUSE_MS = 60_000;

async function nativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return args ? invoke<T>(command, args) : invoke<T>(command);
}

/**
 * The one AI connection Scapi uses, and the model chosen for it.
 *
 * Only the selected connection is ever checked. Checking ChatGPT reads the Keychain and
 * checking Claude starts Claude Code, so connections nobody chose never cost a prompt or a
 * process. Each connection remembers its own model.
 */
export function useAIConnection() {
  const desktop = isDesktop();
  const localDev =
    import.meta.env.DEV &&
    !desktop &&
    typeof location !== "undefined" &&
    location.hostname === "127.0.0.1";
  const providers = availableProviders({ desktop, localDev });
  const [provider, setProvider] = useState<ProviderId>(providers[0]);
  const [restored, setRestored] = useState(false);
  const [chosenModels, setChosenModels] = useState<Partial<Record<ProviderId, string>>>({});
  const [summary, setSummary] = useState<ConnectionSummary>(EMPTY);
  const [claude, setClaude] = useState<ClaudeSummary>({
    installed: false,
    connected: false,
    checked: false,
  });
  const [signInUrl, setSignInUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [claudeConnecting, setClaudeConnecting] = useState(false);
  const claudeLogin = useRef<string | null>(null);
  const claudeCheckedAt = useRef(0);

  const checkChatGPT = useCallback(async () => {
    if (desktop) {
      try {
        const next = await nativeInvoke<ConnectionSummary>("chatgpt_status");
        if (
          !next ||
          !Array.isArray(next.models) ||
          !["connected", "connecting", "disconnected"].includes(next.status)
        )
          throw new Error("Invalid connection summary");
        setSummary(next);
      } catch (error) {
        setSummary({
          ...EMPTY,
          available: true,
          error: isKeychainDenied(error)
            ? "Precipice needs Keychain access to use your saved ChatGPT connection."
            : "Could not read your ChatGPT connection. Check Keychain access and try again.",
        });
      }
      return;
    }
    if (!localDev) return;
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
  }, [desktop, localDev]);

  const checkClaude = useCallback(async () => {
    if (!desktop) return;
    claudeCheckedAt.current = Date.now();
    try {
      const next = await nativeInvoke<ClaudeSummary>("claude_status");
      if (!next || typeof next.installed !== "boolean" || typeof next.connected !== "boolean")
        throw new Error("Could not check Claude Code. Update the app and check again.");
      setClaude({ ...next, checked: true });
    } catch (error) {
      setClaude({ installed: true, connected: false, checked: true, error: String(error) });
    }
  }, [desktop]);

  /** Checks the selected connection now. */
  const refresh = useCallback(
    async (target: ProviderId = provider) => {
      if (target === "chatgpt") await checkChatGPT();
      else if (target === "claude-plan") await checkClaude();
    },
    [provider, checkChatGPT, checkClaude],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const saved = await settingsRepository.get<string>("ai.connection");
      const models = await Promise.all(
        providers.map(
          async (id) => [id, await settingsRepository.get<string>(PROVIDERS[id].modelKey)] as const,
        ),
      );
      if (!active) return;
      if (isProviderId(saved) && providers.includes(saved)) setProvider(saved);
      setChosenModels(Object.fromEntries(models.filter(([, model]) => !!model)));
      setRestored(true);
    })();
    return () => {
      active = false;
    };
    // The environment cannot change while the app runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored) return;
    void refresh(provider);
    const onFocus = () => {
      if (
        provider === "claude-plan" &&
        Date.now() - claudeCheckedAt.current < CLAUDE_FOCUS_REUSE_MS
      )
        return;
      void refresh(provider);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // Re-check only when the selection changes, not when a callback identity does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, provider]);

  useEffect(() => {
    if (provider !== "chatgpt" || summary.status !== "connecting") return;
    const timer = window.setInterval(() => void checkChatGPT(), 1200);
    return () => window.clearInterval(timer);
  }, [provider, summary.status, checkChatGPT]);

  const choose = (next: ProviderId) => {
    if (!providers.includes(next)) return;
    setProvider(next);
    void settingsRepository.set("ai.connection", next);
  };

  const models = modelsFor(provider, summary.models);
  const chosen = chosenModels[provider];
  const modelId = chosen && models.some((model) => model.id === chosen) ? chosen : models[0].id;
  const changeModel = (id: string) => {
    if (!models.some((model) => model.id === id)) return;
    setChosenModels((prev) => ({ ...prev, [provider]: id }));
    void settingsRepository.set(PROVIDERS[provider].modelKey, id);
  };

  const connect = async (newAccount = false) => {
    if (busy || (!localDev && !desktop)) return;
    if (desktop) {
      setBusy(true);
      try {
        await nativeInvoke("chatgpt_connect", { newAccount });
        choose("chatgpt");
        await checkChatGPT();
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
    if (busy || (!localDev && !desktop)) return;
    setBusy(true);
    try {
      if (desktop) {
        if (summary.status === "connecting") {
          await nativeInvoke("chatgpt_cancel_login");
          await checkChatGPT();
          return;
        }
        const result = await nativeInvoke<{ revocationConfirmed: boolean }>("chatgpt_disconnect");
        await checkChatGPT();
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
      await checkChatGPT();
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

  const selectAccount = async (connectionId: string) => {
    if (busy || !desktop) return;
    setBusy(true);
    try {
      await nativeInvoke("chatgpt_select", { connectionId });
      choose("chatgpt");
      await checkChatGPT();
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
      await nativeInvoke("claude_connect", { id });
      choose("claude-plan");
      await checkClaude();
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
    await nativeInvoke("ai_cancel", { id: claudeLogin.current }).catch(() => {});
  };

  const openSettings = async (target: "chatgpt-usage" | "claude-usage" | "claude-install") => {
    if (desktop) {
      try {
        await nativeInvoke("open_ai_settings", { target });
      } catch {
        setSummary((prev) => ({
          ...prev,
          error: "Could not open your browser. Visit ChatGPT or Claude settings to manage usage.",
        }));
      }
    } else window.open("https://chatgpt.com/settings/usage", "_blank", "noopener,noreferrer");
  };

  const status: ConnectionSummary["status"] =
    provider === "claude-plan"
      ? claudeConnecting
        ? "connecting"
        : !claude.checked
          ? "checking"
          : claude.connected
            ? "connected"
            : "disconnected"
      : provider === "chatgpt"
        ? summary.status
        : "connected";

  return {
    desktop,
    providers,
    provider,
    choose,
    /** False until the saved connection and models are restored, so nothing flickers. */
    restored,
    status,
    connectionId:
      provider === "claude-plan"
        ? (claude.connectionId ?? claude.email)
        : provider === "chatgpt"
          ? summary.connectionId
          : undefined,
    error:
      provider === "chatgpt"
        ? summary.error
        : provider === "claude-plan"
          ? claude.error
          : undefined,
    models,
    modelId,
    changeModel,
    refresh,
    chatgpt: summary,
    chatgptAvailable: summary.available || desktop,
    connect,
    disconnect,
    selectAccount,
    signInUrl,
    busy,
    claude,
    claudeConnecting,
    connectClaude,
    cancelClaudeLogin,
    openSettings,
  };
}
export type AIConnection = ReturnType<typeof useAIConnection>;
