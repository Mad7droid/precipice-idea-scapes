import { useCredentials, type DesktopCredentials } from "@/desktop/useCredentials";
import { isDesktop } from "@/desktop/runtime";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MAX_INSTRUCTIONS, SETTING_KEYS } from "@/core/types";
import { DEFAULT_MODEL } from "@/ai/models";
import { settingsRepository } from "@/persistence/settings";

/**
 * The app-wide preferences both screens need: the API key and the model.
 *
 * Web keys live in sessionStorage. Desktop keys live in memory, optionally restored from
 * macOS Keychain. Other preferences remain local data.
 */
interface AppSettings {
  credentials: DesktopCredentials;
  apiKey: string;
  setApiKey: (next: string) => void;
  modelId: string;
  setModelId: (next: string) => void;
  types: string[];
  setTypes: (next: string[]) => void;
  /**
   * Standing generation instructions for every scape in this browser. A browser preference,
   * not document content — a scape's own instructions live on the scape and travel with it.
   */
  instructions: string;
  setInstructions: (next: string) => void;
  ready: boolean;
}

const AppSettingsContext = createContext<AppSettings | null>(null);
const API_KEY_SESSION_KEY = "anthropic.apiKey";

function readSessionApiKey(): string {
  if (isDesktop() || typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(API_KEY_SESSION_KEY) ?? "";
  } catch {
    // Privacy modes can deny browser storage. The key still works for this loaded app.
    return "";
  }
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const credentials = useCredentials();
  const [sessionKey, setApiKeyState] = useState(readSessionApiKey);
  const [modelId, setModelIdState] = useState(DEFAULT_MODEL);
  const [types, setTypesState] = useState<string[]>([]);
  const [instructions, setInstructionsState] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const [model, savedTypes, savedInstructions] = await Promise.all([
        settingsRepository.get<string>(SETTING_KEYS.model),
        settingsRepository.get<string[]>(SETTING_KEYS.generateTypes),
        settingsRepository.get<string>(SETTING_KEYS.instructions),
      ]);
      if (model) setModelIdState(model);
      if (Array.isArray(savedTypes)) setTypesState(savedTypes);
      if (typeof savedInstructions === "string") setInstructionsState(savedInstructions);
      setReady(true);
    })();
  }, []);

  const apiKey = credentials.desktop ? credentials.key : sessionKey;
  const setApiKey = (next: string) => {
    if (credentials.desktop) {
      credentials.change(next);
      return;
    }
    setApiKeyState(next);
    try {
      if (next) window.sessionStorage.setItem(API_KEY_SESSION_KEY, next);
      else window.sessionStorage.removeItem(API_KEY_SESSION_KEY);
    } catch {
      // Keep the key in memory when session storage is unavailable.
    }
  };

  const setModelId = (next: string) => {
    setModelIdState(next);
    void settingsRepository.set(SETTING_KEYS.model, next);
  };

  const setTypes = (next: string[]) => {
    setTypesState(next);
    void settingsRepository.set(SETTING_KEYS.generateTypes, next);
  };

  const setInstructions = (next: string) => {
    const trimmed = next.slice(0, MAX_INSTRUCTIONS);
    setInstructionsState(trimmed);
    void settingsRepository.set(SETTING_KEYS.instructions, trimmed);
  };

  const value = useMemo(
    () => ({
      credentials,
      apiKey,
      setApiKey,
      modelId,
      setModelId,
      types,
      setTypes,
      instructions,
      setInstructions,
      ready: ready && credentials.ready,
    }),
    [credentials, apiKey, modelId, types, instructions, ready],
  );

  return createElement(AppSettingsContext.Provider, { value }, children);
}

export function useAppSettings(): AppSettings {
  const settings = useContext(AppSettingsContext);
  if (!settings) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return settings;
}
