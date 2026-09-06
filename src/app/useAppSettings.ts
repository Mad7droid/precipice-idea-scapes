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
 * The API key lives in sessionStorage rather than IndexedDB or localStorage. Keeping it above
 * the route components lets Home hand off to Editor, and session storage keeps it through a
 * refresh while discarding it when the tab session ends. Everything else remains a browser-
 * local preference.
 */
interface AppSettings {
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
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(API_KEY_SESSION_KEY) ?? "";
  } catch {
    // Privacy modes can deny browser storage. The key still works for this loaded app.
    return "";
  }
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState(readSessionApiKey);
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

  const setApiKey = (next: string) => {
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
      apiKey,
      setApiKey,
      modelId,
      setModelId,
      types,
      setTypes,
      instructions,
      setInstructions,
      ready,
    }),
    [apiKey, modelId, types, instructions, ready],
  );

  return createElement(AppSettingsContext.Provider, { value }, children);
}

export function useAppSettings(): AppSettings {
  const settings = useContext(AppSettingsContext);
  if (!settings) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return settings;
}
