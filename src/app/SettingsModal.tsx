import { useEffect, useState } from "react";
import { SETTING_KEYS, type ThemePreference } from "@/core/types";
import { settingsRepository } from "@/persistence/settings";
import { DEFAULT_MODEL, MODELS } from "@/ai/provider";
import { Select } from "@/design/Select";
import { ThemeControl } from "./ThemeControl";

export function SettingsModal({
  onClose,
  theme,
  onThemeChange,
}: {
  onClose: () => void;
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
}) {
  const [modelId, setModelId] = useState(DEFAULT_MODEL);

  useEffect(() => {
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

        <div className="mt-4">
          <span className="mb-1 block text-xs text-fg-secondary">Theme</span>
          <ThemeControl value={theme} onChange={onThemeChange} />
        </div>

        <p className="mt-4 rounded-md border border-subtle bg-inset p-3 text-xs text-fg-secondary">
          AI requests are protected by the Cloudflare Worker proxy. Your Anthropic API key is
          never entered into or stored in this browser.
        </p>

        <div className="mt-4 block">
          <span className="mb-1 block text-xs text-fg-secondary">Default model</span>
          <Select
            label="Default model"
            value={modelId}
            onChange={(next) => {
              setModelId(next);
              void settingsRepository.set(SETTING_KEYS.model, next);
            }}
            options={MODELS.map((m) => ({ value: m.id, label: m.label, title: m.hint }))}
            className="mono w-full"
          />
        </div>

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
