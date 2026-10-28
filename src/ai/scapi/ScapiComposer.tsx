import { useRef, useState } from "react";
import { webSearchUnavailableReason } from "@/ai/models";
import { ScapiActionIcon } from "@/components/scapi/ScapiActionIcon";
import { Button } from "@/design/Button";
import { MicButton } from "@/dictation/MicButton";
import { useDictation } from "@/dictation/useDictation";
import { appendPhrase } from "@/dictation/vocabulary";
import type { SearchAvailability } from "./types";

/** Scapi's own question box, used when the panel is not given a shared composer. */
export function ScapiComposer({
  streaming,
  onSend,
  onCancel,
  disabled,
  placeholder,
  webSearch,
  onWebSearchChange,
  searchAvailability,
  modelId,
  value,
  onValueChange,
}: {
  streaming: boolean;
  onSend: (question: string) => void;
  onCancel: () => void;
  disabled?: boolean;
  placeholder?: string;
  webSearch: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  searchAvailability: SearchAvailability;
  /** Explains why web search is off; Claude plan connections cannot search. */
  modelId?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const [localDraft, setLocalDraft] = useState("");
  const draft = value ?? localDraft;
  const setDraft = onValueChange ?? setLocalDraft;
  const latest = useRef(draft);
  latest.current = draft;
  const dictation = useDictation((phrase) => {
    latest.current = appendPhrase(latest.current, phrase);
    setDraft(latest.current);
  });
  const canSend = draft.trim().length > 0 && !disabled && !streaming && !dictation.active;

  const submit = () => {
    if (!canSend) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <div className="shrink-0 border-t border-subtle p-3">
      <div className="rounded-2xl border border-subtle bg-inset p-2 transition-colors duration-fast ease-out focus-within:border-focus">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (dictation.handleShortcut(e)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          disabled={disabled}
          placeholder={placeholder ?? "Ask about this scape…"}
          aria-label="Ask Scapi"
          className="focus-self w-full resize-none bg-transparent px-1.5 py-1 text-sm text-fg outline-none placeholder:text-fg-tertiary"
        />
        <div className="flex items-center justify-between px-1.5">
          <div className="flex items-center gap-2">
            {onWebSearchChange && (
              <label
                className="flex items-center gap-1.5 text-xs text-fg-secondary"
                title={
                  searchAvailability === "unavailable"
                    ? webSearchUnavailableReason(modelId ?? "")
                    : "Let Scapi search the web for this question"
                }
              >
                <input
                  type="checkbox"
                  checked={webSearch && searchAvailability !== "unavailable"}
                  onChange={(event) => onWebSearchChange(event.target.checked)}
                  disabled={searchAvailability === "unavailable"}
                  className="accent-accent"
                />
                Search web
              </label>
            )}
            <span className="mono text-fg-tertiary">⌘↵</span>
          </div>
          <div className="flex items-center gap-1">
            {!disabled && <MicButton dictation={dictation} />}
            {streaming ? (
              // Matches the canvas composer: stop is a quiet control, not a second primary.
              <Button variant="neutral" size="sm" shape="icon" onClick={onCancel} aria-label="Stop">
                <span aria-hidden className="block h-2.5 w-2.5 rounded-xs bg-current" />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                shape="icon"
                onClick={submit}
                disabled={!canSend}
                aria-label="Ask"
              >
                <ScapiActionIcon />
              </Button>
            )}
          </div>
        </div>
      </div>
      {searchAvailability === "unavailable" && (
        <p className="mt-1.5 px-1 text-xs text-fg-secondary">
          Web search isn’t enabled for this API key. Turn it on in the Anthropic Console.
        </p>
      )}
    </div>
  );
}
