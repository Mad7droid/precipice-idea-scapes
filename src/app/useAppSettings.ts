import {
  TYPESAFE_CREDENTIAL,
  useCredentials,
  type DesktopCredentials,
} from "@/desktop/useCredentials";
import { useAIConnection } from "@/ai/connection/useAIConnection";
import { MODELS, type ModelChoice } from "@/ai/models";
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
  connection: ReturnType<typeof useAIConnection>;
  aiReady: boolean;
  models: ModelChoice[];
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
  /** Route chips in the editor composers. Off by default; off means today's manual path. */
  routeChips: boolean;
  setRouteChips: (next: boolean) => void;
  /** Whether routing may ask TypeSafe Jev. Needs `jevKey` as well; both default off. */
  jevRouting: boolean;
  setJevRouting: (next: boolean) => void;
  /** Route with Jev alone. Only meaningful while Jev routing is on. */
  jevOnly: boolean;
  setJevOnly: (next: boolean) => void;
  /** Stored exactly like the Anthropic key: tab session on the web, optional Keychain on Mac. */
  jevKey: string;
  setJevKey: (next: string) => void;
  jevCredentials: DesktopCredentials;
  ready: boolean;
}

const AppSettingsContext = createContext<AppSettings | null>(null);
const API_KEY_SESSION_KEY = "anthropic.apiKey";
const JEV_KEY_SESSION_KEY = "typesafe.apiKey";

function readSessionApiKey(name = API_KEY_SESSION_KEY): string {
  if (isDesktop() || typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(name) ?? "";
  } catch {
    // Privacy modes can deny browser storage. The key still works for this loaded app.
    return "";
  }
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const connection = useAIConnection();
  const credentials = useCredentials();
  const jevCredentials = useCredentials(TYPESAFE_CREDENTIAL);
  const [sessionKey, setApiKeyState] = useState(() => readSessionApiKey());
  const [jevSessionKey, setJevKeyState] = useState(() => readSessionApiKey(JEV_KEY_SESSION_KEY));
  const [routeChips, setRouteChipsState] = useState(false);
  const [jevRouting, setJevRoutingState] = useState(false);
  const [jevOnly, setJevOnlyState] = useState(false);
  const [modelId, setModelIdState] = useState(DEFAULT_MODEL);
  const [types, setTypesState] = useState<string[]>([]);
  const [instructions, setInstructionsState] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const [model, savedTypes, savedInstructions, savedChips, savedJev, savedJevOnly] =
        await Promise.all([
        settingsRepository.get<string>(SETTING_KEYS.model),
        settingsRepository.get<string[]>(SETTING_KEYS.generateTypes),
        settingsRepository.get<string>(SETTING_KEYS.instructions),
        settingsRepository.get<boolean>(SETTING_KEYS.routeChips),
        settingsRepository.get<boolean>(SETTING_KEYS.jevRouting),
        settingsRepository.get<boolean>(SETTING_KEYS.jevOnly),
      ]);
      if (savedChips === true) setRouteChipsState(true);
      if (savedJev === true) setJevRoutingState(true);
      if (savedJevOnly === true) setJevOnlyState(true);
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

  const jevKey = jevCredentials.desktop ? jevCredentials.key : jevSessionKey;
  const setJevKey = (next: string) => {
    if (jevCredentials.desktop) {
      jevCredentials.change(next);
      return;
    }
    setJevKeyState(next);
    try {
      if (next) window.sessionStorage.setItem(JEV_KEY_SESSION_KEY, next);
      else window.sessionStorage.removeItem(JEV_KEY_SESSION_KEY);
    } catch {
      // Keep the key in memory when session storage is unavailable.
    }
  };

  const setRouteChips = (next: boolean) => {
    setRouteChipsState(next);
    void settingsRepository.set(SETTING_KEYS.routeChips, next);
  };

  const setJevOnly = (next: boolean) => {
    setJevOnlyState(next);
    void settingsRepository.set(SETTING_KEYS.jevOnly, next);
  };

  const setJevRouting = (next: boolean) => {
    setJevRoutingState(next);
    void settingsRepository.set(SETTING_KEYS.jevRouting, next);
  };

  const setModelId = (next: string) => {
    if (connection.provider !== "anthropic") {
      connection.changeModel(next);
      return;
    }
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
      connection,
      models: connection.provider !== "anthropic" ? connection.models : MODELS,
      aiReady:
        connection.provider !== "anthropic" ? connection.status === "connected" : !!apiKey.trim(),
      credentials,
      apiKey,
      setApiKey,
      modelId: connection.provider !== "anthropic" ? connection.modelId : modelId,
      setModelId,
      types,
      setTypes,
      instructions,
      setInstructions,
      routeChips,
      setRouteChips,
      jevRouting,
      setJevRouting,
      jevOnly,
      setJevOnly,
      jevKey,
      setJevKey,
      jevCredentials,
      ready: ready && credentials.ready,
    }),
    [
      connection,
      credentials,
      jevCredentials,
      apiKey,
      jevKey,
      modelId,
      types,
      instructions,
      routeChips,
      jevRouting,
      jevOnly,
      ready,
    ],
  );

  return createElement(AppSettingsContext.Provider, { value }, children);
}

export function useAppSettings(): AppSettings {
  const settings = useContext(AppSettingsContext);
  if (!settings) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return settings;
}
