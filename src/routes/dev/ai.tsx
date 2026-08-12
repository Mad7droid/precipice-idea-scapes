import { useEffect, useRef, useState } from "react";
import { Link } from "@/app/router";
import { useAppSettings } from "@/app/useAppSettings";
import { fixtureScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { MODELS } from "@/ai/models";
import { projectScape } from "@/ai/context";
import { EVALS, formatEvalTable, runEvals, type EvalResult } from "@/ai/evals";
import { useGeneration } from "@/ai/useGeneration";
import { Ribbon } from "@/ai/Ribbon";
import { Composer } from "@/ai/Composer";
import { ScapeyPanel } from "@/ai/scapey/ScapeyPanel";
import { useScapey } from "@/ai/scapey/useScapey";
import { suggestScapeyQuestions } from "@/ai/scapey/suggestions";
import { Select } from "@/design/Select";

/**
 * Workstream C's harness. Exercises the full generation loop — provider, context projection,
 * tools, streaming apply, ribbon — against the in-memory store with no canvas mounted.
 */
export function DevAi() {
  const scape = useScapeStore((s) => s.scape);
  const { apiKey, setApiKey, modelId, setModelId } = useAppSettings();
  const [scope, setScope] = useState<"scape" | "selection">("scape");
  const [types, setTypes] = useState<string[]>([]);
  const [evalResults, setEvalResults] = useState<EvalResult[] | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);
  const evalAbort = useRef<AbortController | null>(null);

  const { state, start, startRecorded, cancel, undo, dismiss } = useGeneration();

  // Scapey runs against the same store, but through its own path: read-only tools, its own
  // context projection, and nothing that can reach the reducer.
  const scapey = useScapey({
    getScape: () => useScapeStore.getState().scape,
    getSelection: () => useScapeStore.getState().selection,
    apiKey,
    modelId,
  });

  useEffect(() => {
    if (!scape) useScapeStore.getState().loadScape(fixtureScape());
  }, [scape]);

  const projection = scape
    ? projectScape(scape, { selection: useScapeStore.getState().selection })
    : null;

  const runAllEvals = async () => {
    if (!apiKey.trim()) return;
    setEvalRunning(true);
    setEvalResults([]);
    evalAbort.current = new AbortController();
    try {
      const results = await runEvals({
        apiKey,
        modelId,
        signal: evalAbort.current.signal,
        onResult: (r) => setEvalResults((prev) => [...(prev ?? []), r]),
      });
      setEvalResults(results);
    } finally {
      setEvalRunning(false);
    }
  };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col bg-base">
        <div className="min-w-0 flex-1 overflow-auto p-6">
          <Link to="/dev" className="mono">
            ← dev
          </Link>
          <h1 className="mt-2 text-2xl text-fg">AI</h1>
          <p className="mt-1 text-fg-secondary">
            A prompt becomes validated actions, applied one at a time, undoable as one step.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              aria-label="Anthropic API key"
              className="mono w-[280px] rounded-md border border-subtle bg-inset px-2 py-1.5 text-fg"
            />
            <Select
              label="Model"
              value={modelId}
              onChange={setModelId}
              options={MODELS.map((m) => ({ value: m.id, label: m.label, title: m.hint }))}
              className="mono"
            />
            <Command onClick={() => void startRecorded()} disabled={state.status === "streaming"}>
              Replay recorded (no key needed)
            </Command>
            <Command onClick={() => void runAllEvals()} disabled={evalRunning || !apiKey.trim()}>
              {evalRunning ? "Running evals…" : `Run evals (${EVALS.length})`}
            </Command>
          </div>

          <dl className="mono mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt>scape</dt>
            <dd className="text-fg-secondary">{scape ? scape.objectOrder.length : 0} objects</dd>
            <dt>projected tokens</dt>
            <dd className="text-fg-secondary">
              {projection ? `${projection.estimatedTokens} (${projection.omitted} omitted)` : "—"}
            </dd>
          </dl>

          {evalResults && evalResults.length > 0 && (
            <>
              <h2 className="mono mt-6">eval results</h2>
              <pre className="mono mt-2 overflow-x-auto whitespace-pre rounded-md border border-subtle bg-inset p-3 normal-case tracking-normal text-fg-secondary">
                {formatEvalTable(evalResults)}
              </pre>
            </>
          )}

          <h2 className="mono mt-6">applied · {state.applied}</h2>
          {state.lines.length === 0 ? (
            <p className="mt-1 text-xs text-fg-tertiary">Nothing applied yet.</p>
          ) : (
            <ol className="mono mt-2 space-y-0.5 normal-case tracking-normal text-fg-secondary">
              {state.lines.map((line) => (
                <li key={line.key}>{line.text}</li>
              ))}
            </ol>
          )}

          <h2 className="mono mt-6">skipped · {state.skipped.length}</h2>
          {state.skipped.length === 0 ? (
            <p className="mt-1 text-xs text-fg-tertiary">Nothing skipped.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {state.skipped.map((s, i) => (
                <li key={i}>
                  <span className="mono normal-case tracking-normal text-fg-secondary">
                    {s.tool}
                  </span>
                  {" — "}
                  {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-subtle bg-surface p-4">
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2">
            <Ribbon state={state} onCancel={cancel} onUndo={undo} onDismiss={dismiss} />
            <Composer
              onSend={(request) =>
                void start({ request, apiKey, modelId, allowedTypes: types, scope })
              }
              onCancel={cancel}
              busy={state.status === "streaming"}
              modelId={modelId}
              onModelChange={setModelId}
              scope={scope}
              onScopeChange={setScope}
              types={types}
              onTypesChange={setTypes}
              selectionCount={useScapeStore.getState().selection.length}
              disabled={!apiKey.trim()}
              placeholder={apiKey.trim() ? undefined : "Add an API key above to generate."}
            />
          </div>
        </div>
      </div>

      {/* 560px, not the inspector's 320 — a comparison table is the shape this panel is most
          often asked for, and it is unreadable in a narrow rail. */}
      <aside className="flex h-full w-[560px] shrink-0 flex-col border-l border-subtle">
        <div className="flex shrink-0 items-center justify-between border-b border-subtle bg-surface px-4 py-2.5">
          <h2 className="text-sm font-[var(--weight-emph)] text-fg">Scapey</h2>
          <button
            type="button"
            onClick={scapey.clear}
            disabled={scapey.turns.length === 0}
            className="mono text-fg-tertiary transition-colors duration-instant ease-out hover:text-fg disabled:opacity-40"
          >
            clear
          </button>
        </div>
        <ScapeyPanel
          turns={scapey.turns}
          streaming={scapey.streaming}
          onSend={(question) => void scapey.send(question)}
          onCancel={scapey.cancel}
          onRetry={scapey.retry}
          objects={scape?.objects}
          onObjectClick={(id) => useScapeStore.getState().setSelection([id])}
          suggestions={scape ? suggestScapeyQuestions(scape) : []}
          disabled={!apiKey.trim()}
          {...(apiKey.trim() ? {} : { placeholder: "Add an API key above to ask." })}
        />
      </aside>
    </div>
  );
}

function Command({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-subtle px-2.5 py-1 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
