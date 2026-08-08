import { useEffect, useState } from "react";
import { SETTING_KEYS } from "@/core/types";
import { DEFAULT_MODEL } from "@/ai/provider";
import { settingsRepository } from "@/persistence/settings";

/**
 * The browser-local preferences both screens need: the API key and the model.
 *
 * Home and the editor can each send a generation, so both need these, and neither should read
 * IndexedDB in its own way. `ready` exists because rendering a key field as empty before the
 * stored value has loaded looks exactly like having no key at all.
 */
export function useAppSettings() {
  const [apiKey, setApiKeyState] = useState("");
  const [modelId, setModelIdState] = useState(DEFAULT_MODEL);
  const [types, setTypesState] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const [key, model, savedTypes] = await Promise.all([
        settingsRepository.get<string>(SETTING_KEYS.apiKey),
        settingsRepository.get<string>(SETTING_KEYS.model),
        settingsRepository.get<string[]>(SETTING_KEYS.generateTypes),
      ]);
      if (key) setApiKeyState(key);
      if (model) setModelIdState(model);
      if (Array.isArray(savedTypes)) setTypesState(savedTypes);
      setReady(true);
    })();
  }, []);

  const setApiKey = (next: string) => {
    setApiKeyState(next);
    void settingsRepository.set(SETTING_KEYS.apiKey, next);
  };

  const setModelId = (next: string) => {
    setModelIdState(next);
    void settingsRepository.set(SETTING_KEYS.model, next);
  };

  const setTypes = (next: string[]) => {
    setTypesState(next);
    void settingsRepository.set(SETTING_KEYS.generateTypes, next);
  };

  return { apiKey, setApiKey, modelId, setModelId, types, setTypes, ready };
}
