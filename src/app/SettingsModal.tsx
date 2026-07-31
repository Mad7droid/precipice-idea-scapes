import { useEffect, useState } from "react";
import { SETTING_KEYS } from "@/core/types";
import { settingsRepository } from "@/persistence/settings";
import { DEFAULT_MODEL, MODELS } from "@/ai/provider";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_MODEL);

  useEffect(() => {
    void settingsRepository.get<string>(SETTING_KEYS.apiKey).then((k) => k && setApiKey(k));
    void settingsRepository.get<string>(SETTING_KEYS.model).then((m) => m && setModelId(m));
  }, []);

  return (
    <div
      className="fixed inset-0 z-modal grid place-items-center bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-[420px] rounded-xl border border-subtle bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Settings"
      >
        <h2 className="text-lg text-fg">Settings</h2>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs text-fg-secondary">Anthropic API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              const next = e.target.value;
              setApiKey(next);
              void settingsRepository.set(SETTING_KEYS.apiKey, next);
            }}
            placeholder="sk-ant-…"
            className="mono w-full rounded-md border border-subtle bg-inset px-2.5 py-1.5 text-fg placeholder:text-fg-tertiary focus:border-focus focus:outline-none"
          />
        </label>
        <p className="mt-1.5 text-xs text-fg-tertiary">
          Stored in this browser's IndexedDB, in plain text. There is nowhere in a browser to
          put it that would be meaningfully safer. Real encryption arrives with the desktop
          app.
        </p>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs text-fg-secondary">Default model</span>
          <select
            value={modelId}
            onChange={(e) => {
              const next = e.target.value;
              setModelId(next);
              void settingsRepository.set(SETTING_KEYS.model, next);
            }}
            className="mono w-full rounded-md border border-subtle bg-inset px-2.5 py-1.5 text-fg focus:border-focus focus:outline-none"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id} title={m.hint}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-on-accent transition-colors duration-instant ease-out hover:bg-accent-hover"
        >
          Done
        </button>
      </div>
    </div>
  );
}
