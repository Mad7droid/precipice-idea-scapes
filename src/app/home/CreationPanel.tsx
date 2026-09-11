import { Composer } from "@/ai/Composer";
import { STARTERS, getStarter } from "@/starters";
import { useAppSettings } from "../useAppSettings";

export const HOME_BUTTON =
  "rounded-md border border-subtle bg-surface px-3 py-2 text-sm text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover active:bg-selected disabled:opacity-50 disabled:cursor-wait";
export function CreationPanel({
  firstUse,
  starterId,
  onStarterChange,
  draft,
  onDraftChange,
  busy,
  onCreate,
  onSettings,
}: {
  firstUse: boolean;
  starterId: string;
  onStarterChange: (id: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  busy: boolean;
  onCreate: (prompt: string | null) => void;
  onSettings: () => void;
}) {
  const { apiKey, modelId, setModelId, types, setTypes } = useAppSettings();
  const starter = getStarter(starterId);
  return (
    <section
      aria-label="Create a scape"
      className={`rounded-xl border border-subtle bg-surface p-4 ${firstUse ? "sm:p-5" : ""}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-fg">Start something new</h2>
        <span className="text-xs text-fg-tertiary">
          {apiKey.trim() ? (
            "API key configured"
          ) : (
            <button
              type="button"
              onClick={onSettings}
              className="text-fg-accent underline underline-offset-4"
            >
              Add API key to generate
            </button>
          )}
        </span>
      </div>
      <div
        className={
          firstUse ? "mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5" : "mb-3 flex flex-wrap gap-2"
        }
        role="group"
        aria-label="Starting shape"
      >
        {STARTERS.map((item) => (
          <button
            type="button"
            key={item.id}
            disabled={busy}
            aria-pressed={starterId === item.id}
            onClick={() => onStarterChange(item.id)}
            className={`${HOME_BUTTON} text-left ${starterId === item.id ? "border-focus bg-selected text-fg" : ""}`}
          >
            <span className="block">{item.label}</span>
            {firstUse && (
              <span className="mt-2 block text-xs font-normal leading-5 text-fg-tertiary">
                {item.blurb}
              </span>
            )}
          </button>
        ))}
      </div>
      {!firstUse && <p className="sr-only">{starter.blurb}</p>}
      <Composer
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
        availableTypes={starter.types}
        selectionCount={0}
        placeholder={starter.placeholder}
        controls={{ scope: false, types: false }}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-fg-tertiary">{starter.blurb}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => onCreate(null)}
          className={HOME_BUTTON}
        >
          Create without AI <span aria-hidden>↗</span>
        </button>
      </div>
    </section>
  );
}
