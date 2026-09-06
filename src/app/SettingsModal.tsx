import { useEffect, useState } from "react";
import { MAX_INSTRUCTIONS, SETTING_KEYS, type ThemePreference } from "@/core/types";
import { settingsRepository } from "@/persistence/settings";
import { DEFAULT_MODEL, MODELS } from "@/ai/models";
import { Select } from "@/design/Select";
import { InstructionsField } from "@/ai/Instructions";
import { ThemeControl } from "./ThemeControl";
import { useDialogFocus } from "./home/Dialog";
import { McpBridgePanel } from "./McpBridgePanel";
import type { McpBridge } from "@/mcp/bridge";

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
}) {
  const dialogRef = useDialogFocus(onClose);
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [section, setSection] = useState<SectionId>("general");

  useEffect(() => {
    void settingsRepository.get<string>(SETTING_KEYS.model).then((m) => m && setModelId(m));
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

                <div className="mt-5 block">
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
              </>
            )}

            {section === "ai" && (
              <>
                <div>
                  <label
                    htmlFor="anthropic-api-key"
                    className="mb-1 block text-xs text-fg-secondary"
                  >
                    Anthropic API key
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="anthropic-api-key"
                      type="password"
                      value={apiKey}
                      onChange={(e) => onApiKeyChange(e.target.value)}
                      placeholder="sk-ant-…"
                      autoComplete="off"
                      spellCheck={false}
                      className="mono min-w-0 flex-1 rounded-md border border-subtle bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-tertiary focus-self"
                    />
                    {apiKey && (
                      <button
                        type="button"
                        onClick={() => onApiKeyChange("")}
                        className="rounded-md border border-subtle px-3 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-fg-tertiary">
                    Required to generate. Kept for this tab session and cleared when the tab is
                    closed, then forwarded through the Precipice Worker, which keeps no key of its
                    own and stores nothing.
                  </p>
                </div>

                {onInstructionsChange && (
                  <div className="mt-5">
                    <label
                      htmlFor="global-instructions"
                      className="mb-1 block text-xs text-fg-secondary"
                    >
                      Generation instructions
                    </label>
                    <InstructionsField
                      id="global-instructions"
                      value={instructions ?? ""}
                      onChange={onInstructionsChange}
                      maxLength={MAX_INSTRUCTIONS}
                      rows={6}
                    />
                    <p className="mt-2 text-xs text-fg-tertiary">
                      Optional. Applied to every generation in this browser. Each scape can add its
                      own on top, from the composer.
                    </p>
                  </div>
                )}
              </>
            )}

            {section === "agent" && (
              <>
                {mcpBridge ? (
                  <McpBridgePanel bridge={mcpBridge} embedded />
                ) : (
                  <p className="text-xs text-fg-tertiary">
                    Open a scape to share it with a local agent.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-subtle px-5 py-3">
            {onOpenHelp ? (
              <button
                type="button"
                onClick={onOpenHelp}
                className="rounded-full border border-subtle px-3 py-1.5 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
              >
                Help & keyboard shortcuts
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-accent px-5 py-1.5 text-on-accent transition-colors duration-instant ease-out hover:bg-accent-hover"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type SectionId = "general" | "ai" | "agent";

/** Three, because there are three concerns here — not because a sidebar wants filling. */
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "ai", label: "AI" },
  { id: "agent", label: "Agent" },
];
