import { AISettings } from "@/ai/connection/ConnectionSettings";
import type { useAppSettings } from "./useAppSettings";
import type { DesktopCredentials } from "@/desktop/useCredentials";
import { useEffect, useState } from "react";
import { MAX_INSTRUCTIONS, SETTING_KEYS, type ThemePreference } from "@/core/types";
import { settingsRepository } from "@/persistence/settings";
import { Button } from "@/design/Button";
import { Select } from "@/design/Select";
import { InstructionsField } from "@/ai/Instructions";
import { ThemeControl } from "./ThemeControl";
import { useDialogFocus } from "./home/Dialog";
import { McpBridgePanel } from "./McpBridgePanel";
import { AgentsPanel } from "./agents/AgentsPanel";
import type { McpBridge } from "@/mcp/bridge";
import packageInfo from "../../package.json";
import { DICTATION_LANGUAGES, type DictationLanguage } from "@/dictation/engine";

export function SettingsModal({
  onClose,
  theme,
  apiKey,
  onApiKeyChange,
  instructions,
  onInstructionsChange,
  onThemeChange,
  onOpenHelp,
  mcpBridge,
  credentials,
  routingSettings,
  initialSection = "general",
}: {
  onClose: () => void;
  theme: ThemePreference;
  apiKey: string;
  onApiKeyChange: (apiKey: string) => void;
  /** Standing instructions for every scape in this browser. Optional, and usually empty. */
  instructions?: string;
  onInstructionsChange?: (next: string) => void;
  onThemeChange: (next: ThemePreference) => void;
  onOpenHelp?: () => void;
  mcpBridge?: McpBridge;
  credentials?: DesktopCredentials;
  routingSettings?: ReturnType<typeof useAppSettings>;
  /** Where to open, when the caller already knows which concern brought the person here. */
  initialSection?: SettingsSection;
}) {
  const dialogRef = useDialogFocus(onClose);
  const [section, setSection] = useState<SectionId>(initialSection);
  const [dictationLanguage, setDictationLanguage] = useState<DictationLanguage>("en");

  useEffect(() => {
    void settingsRepository
      .get<DictationLanguage>(SETTING_KEYS.dictationLanguage)
      .then((l) => l && setDictationLanguage(l));
  }, []);

  return (
    <div
      className="fixed inset-0 z-modal grid place-items-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        // Sectioned rather than one long column: the list had grown past the viewport, and a
        // dialog you have to scroll to reach Done in is a dialog that has outgrown its shape.
        // Each section is short enough to need no scrolling of its own.
        className="flex h-[min(440px,calc(100vh-32px))] w-[calc(100vw-32px)] max-w-[620px] overflow-hidden rounded-xl border border-subtle bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        aria-modal
        aria-label="Settings"
      >
        <nav
          aria-label="Settings sections"
          className="flex w-[150px] shrink-0 flex-col gap-0.5 border-r border-subtle bg-inset p-3"
        >
          <h2 className="mono mb-1 px-2">Settings</h2>
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-current={section === entry.id}
              onClick={() => setSection(entry.id)}
              className={
                "rounded-md px-2 py-1.5 text-left transition-colors duration-instant ease-out " +
                (section === entry.id
                  ? "bg-raised text-fg"
                  : "text-fg-secondary hover:bg-hover hover:text-fg")
              }
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {section === "general" && (
              <>
                <div>
                  <span className="mb-1 block text-xs text-fg-secondary">Theme</span>
                  <ThemeControl value={theme} onChange={onThemeChange} />
                </div>

                {credentials?.desktop && (
                  <div className="mt-5 block">
                    <span className="mb-1 block text-xs text-fg-secondary">Dictation language</span>
                    <Select
                      label="Dictation language"
                      value={dictationLanguage}
                      onChange={(next) => {
                        setDictationLanguage(next as DictationLanguage);
                        void settingsRepository.set(SETTING_KEYS.dictationLanguage, next);
                      }}
                      options={DICTATION_LANGUAGES}
                      className="w-full"
                    />
                    <p className="mt-2 text-xs text-fg-tertiary">
                      Speech is turned into text on this Mac. Audio is never saved or sent.
                    </p>
                  </div>
                )}

                <p className="mt-5 text-xs text-fg-tertiary">
                  Precipice version {packageInfo.version}
                </p>
              </>
            )}

            {section === "ai" && (
              <>
                {routingSettings ? (
                  <AISettings
                    settings={routingSettings}
                    apiKey={apiKey}
                    onApiKeyChange={onApiKeyChange}
                  />
                ) : null}
                <section aria-label="Instructions" className="mt-6 space-y-2">
                  <h3 className="text-sm font-medium text-fg">
                    <label htmlFor="global-instructions">Instructions</label>
                  </h3>
                  {onInstructionsChange ? (
                    <>
                      <InstructionsField
                        id="global-instructions"
                        value={instructions ?? ""}
                        onChange={onInstructionsChange}
                        maxLength={MAX_INSTRUCTIONS}
                        rows={4}
                      />
                      <p className="text-xs text-fg-tertiary">
                        Optional. Applied to every generation in this browser. Each scape can add
                        its own from the composer.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-fg-tertiary">
                      Open a scape to set generation instructions.
                    </p>
                  )}
                </section>
              </>
            )}

            {section === "agent" && (
              <>
                <AgentsPanel />
                {mcpBridge && import.meta.env.DEV && (
                  <details className="mt-5">
                    <summary className="cursor-pointer text-xs text-fg-tertiary">
                      Developer bridge
                    </summary>
                    <McpBridgePanel bridge={mcpBridge} embedded />
                  </details>
                )}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-subtle px-5 py-3">
            {onOpenHelp ? (
              <Button variant="secondary" shape="pill" onClick={onOpenHelp}>
                Help & keyboard shortcuts
              </Button>
            ) : (
              <span />
            )}
            <Button variant="primary" shape="pill" onClick={onClose} className="px-5">
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

type SectionId = "general" | "ai" | "agent";
export type SettingsSection = SectionId;

/** Three, because there are three concerns here — not because a sidebar wants filling. */
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "ai", label: "AI" },
  { id: "agent", label: "Agents" },
];
