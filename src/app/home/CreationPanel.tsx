import type { RefObject } from "react";
import { Composer } from "@/ai/Composer";
import { Scapi } from "@/components/scapi/Scapi";
import { STARTERS, getStarter } from "@/starters";
import { useAppSettings } from "../useAppSettings";
import { StarterMark } from "./StarterMark";

/**
 * Where a new scape starts: one question, one prompt, one row of templates.
 *
 * Everything else a template decides — the blocks it focuses on, its layout, what an empty start
 * holds — is on the Templates page. Home shows only what is needed to begin, so the first glance
 * has one obvious thing to do.
 */
export function CreationPanel({
  firstUse,
  starterId,
  onStarterChange,
  draft,
  onDraftChange,
  busy,
  onCreate,
  onSettings,
  inputRef,
}: {
  firstUse: boolean;
  starterId: string;
  onStarterChange: (id: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  busy: boolean;
  onCreate: (prompt: string | null) => void;
  onSettings: () => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { apiKey, modelId, setModelId, types, setTypes } = useAppSettings();
  const starter = getStarter(starterId);
  const hasKey = !!apiKey.trim();

  // Arrow keys move between templates, as in any radio group; Tab leaves the group in one stop.
  const onTemplateKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = STARTERS.findIndex((s) => s.id === starterId);
    const next = STARTERS[(index + step + STARTERS.length) % STARTERS.length];
    onStarterChange(next.id);
    event.currentTarget.querySelector<HTMLElement>(`[data-starter="${next.id}"]`)?.focus();
  };

  return (
    <section aria-labelledby="create-heading" className="mx-auto w-full max-w-3xl">
      {/* The box reserves the mascot's space before its artwork loads, so nothing below moves. */}
      <div className="mx-auto mb-4 aspect-[7/6] w-28 sm:w-36">
        <Scapi
          state={busy ? "thinking" : "idle"}
          size={144}
          playful
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <h1 id="create-heading" className="text-center font-pixel text-2xl text-fg sm:text-3xl">
        What are you working on?
      </h1>
      {firstUse && (
        <p className="mx-auto mt-3 max-w-xl text-center text-base text-fg-secondary">
          Describe an idea and Precipice drafts it as connected notes, journeys, screens and
          documents on one canvas. Everything stays editable, and saved on this device.
        </p>
      )}

      <div className="mt-6">
        <Composer
          inputRef={inputRef}
          value={draft}
          onValueChange={onDraftChange}
          onSend={onCreate}
          onCancel={() => {}}
          busy={false}
          disabled={busy}
          sendLabel={busy ? "Creating…" : "Generate"}
          modelId={modelId}
          onModelChange={setModelId}
          scope="scape"
          onScopeChange={() => {}}
          types={types}
          onTypesChange={setTypes}
          selectionCount={0}
          placeholder={starter.placeholder}
          controls={{ scope: false, types: false }}
        />
      </div>

      <div
        role="radiogroup"
        aria-label="Template"
        onKeyDown={onTemplateKey}
        className="mt-4 flex flex-wrap justify-center gap-2"
      >
        {STARTERS.map((item) => {
          const active = starterId === item.id;
          return (
            <button
              type="button"
              key={item.id}
              data-starter={item.id}
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              disabled={busy}
              title={item.blurb}
              onClick={() => onStarterChange(item.id)}
              className={
                "inline-flex items-center gap-2 rounded-full border py-1.5 pl-2.5 pr-3.5 text-sm transition-colors duration-fast ease-out disabled:cursor-wait " +
                (active
                  ? "border-focus bg-selected text-fg"
                  : "border-subtle bg-surface text-fg-secondary hover:border-default hover:text-fg")
              }
            >
              <StarterMark starter={item} active={active} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-fg-tertiary">
        {!draft.trim() && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDraftChange(starter.example)}
            className="hover:text-fg"
          >
            Try an example
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onCreate(null)}
          title={`Starts with ${starter.startsWith.toLowerCase()}`}
          className="hover:text-fg"
        >
          Start empty
        </button>
        {!hasKey && (
          <button type="button" onClick={onSettings} className="text-fg-accent hover:underline">
            Add API key to generate
          </button>
        )}
      </div>
    </section>
  );
}
