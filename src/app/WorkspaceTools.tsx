import { useEffect, useRef, useState } from "react";
import { notify } from "@/core/notify";
import { Button } from "@/design/Button";
import { scapeRepository } from "@/persistence/scapeRepository";
import type { ContentMatch } from "@/persistence/contentSearch";
import { MAX_CAPTURE_LENGTH, workspaceRepository } from "@/persistence/workspace";
import { Dialog } from "./home/Dialog";
import { navigate, scapeRoute } from "./router";
import { setPendingFocus } from "./pending";
import { WORKSPACE_EVENT, type WorkspaceCommand } from "./workspaceEvents";

let search: Promise<import("@/persistence/contentSearch").ContentSearch> | undefined;
const searchEngine = () =>
  (search ??= import("@/persistence/contentSearch").then(
    ({ ContentSearch }) => new ContentSearch(scapeRepository),
  ));

/** An unsaved capture survives closing the dialog and reloads in this tab only: session storage,
 * never IndexedDB, exports or logs. Saving or discarding clears it. */
const DRAFT_KEY = "precipice.capture.draft";
function readDraft(): string {
  try {
    return (sessionStorage.getItem(DRAFT_KEY) ?? "").slice(0, MAX_CAPTURE_LENGTH);
  } catch {
    return "";
  }
}
function writeDraft(text: string): void {
  try {
    if (text) sessionStorage.setItem(DRAFT_KEY, text.slice(0, MAX_CAPTURE_LENGTH));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* the draft stays in memory for this page */
  }
}

export function WorkspaceTools() {
  const [tool, setTool] = useState<WorkspaceCommand | null>(null);
  const [draft, setDraftState] = useState(readDraft);
  const setDraft = (text: string) => {
    setDraftState(text);
    writeDraft(text);
  };
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    const open = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (value === "capture" || value === "search") setTool(value);
    };
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.altKey && !event.shiftKey && event.code === "KeyN") {
        event.preventDefault();
        setTool("capture");
      }
      if (event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setTool("search");
      }
    };
    window.addEventListener(WORKSPACE_EVENT, open);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener(WORKSPACE_EVENT, open);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const save = async () => {
    if (!draft.trim() || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await workspaceRepository.capture(draft);
      setDraft("");
      setTool(null);
      window.dispatchEvent(new Event("precipice:library-changed"));
      notify.success("Saved to Inbox.");
    } catch (error) {
      notify.error(
        "Could not save the note",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  if (tool === "search") return <SearchDialog onClose={() => setTool(null)} />;
  if (tool !== "capture") return null;
  return (
    <Dialog
      title="Capture a note"
      onClose={() => {
        if (!savingRef.current) setTool(null);
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor="capture-note" className="mt-4 block text-xs text-fg-secondary">
          Saved locally. No AI connection required.
        </label>
        <textarea
          id="capture-note"
          data-initial-focus
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_CAPTURE_LENGTH}
          rows={7}
          placeholder="Write a note…"
          className="mt-2 w-full resize-y rounded-md border border-default bg-inset px-3 py-2 text-base text-fg placeholder:text-fg-tertiary selection:bg-selected selection:text-fg focus-self"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          {draft && (
            <>
              <span className="mr-auto text-xs text-fg-tertiary">
                Draft kept until you close this tab.
              </span>
              <Button variant="ghost" disabled={saving} onClick={() => setDraft("")}>
                Discard
              </Button>
            </>
          )}
          <Button variant="secondary" disabled={saving} onClick={() => setTool(null)}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !draft.trim()}>
            {saving ? "Saving…" : "Save to Inbox"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContentMatch[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [partial, setPartial] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => setActive(0), [results]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    const controller = new AbortController();
    if (!query.trim()) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    const timer = window.setTimeout(() => {
      void searchEngine()
        .then(async (engine) => ({
          found: await engine.search(query, controller.signal),
          partial: engine.partial,
        }))
        .then(({ found, partial }) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setPartial(partial);
          setStatus("done");
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus("error");
        });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);
  const open = (match: ContentMatch) => {
    if (match.objectId) setPendingFocus(match.scapeId, match.objectId);
    navigate(scapeRoute(match.scapeId));
    window.dispatchEvent(new Event("precipice:focus-pending"));
    onClose();
  };
  return (
    <Dialog title="Search your library" onClose={onClose}>
      <input
        data-initial-focus
        type="search"
        aria-label="Search content"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (!results.length || status === "searching") return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i + step + results.length) % results.length);
          } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            open(results[active] ?? results[0]);
          }
        }}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="content-search-results"
        aria-activedescendant={results.length ? `content-search-${active}` : undefined}
        maxLength={200}
        placeholder="Search names, notes, tags and flows"
        className="mt-4 w-full rounded-md border border-default bg-inset px-3 py-2 text-base text-fg placeholder:text-fg-tertiary selection:bg-selected selection:text-fg focus-self"
      />
      <p role="status" className="mt-3 text-xs text-fg-secondary">
        {status === "searching"
          ? "Searching local content…"
          : status === "error"
            ? "Could not search. Close and try again."
            : status === "idle"
              ? "Content stays on this device."
              : `${results.length}${results.length >= 60 ? "+" : ""} ${results.length === 1 ? "result" : "results"}`}
      </p>
      {partial && status === "done" && (
        <p className="mt-1 text-xs text-fg-secondary">
          Large scapes are partially indexed. Search by scape name to open all content.
        </p>
      )}
      <ul
        ref={list}
        id="content-search-results"
        role="listbox"
        aria-label="Search results"
        className="mt-3 max-h-[min(50vh,420px)] overflow-y-auto"
      >
        {results.map((match, i) => (
          <li
            key={`${match.scapeId}:${match.objectId ?? i}`}
            id={`content-search-${i}`}
            role="option"
            aria-selected={i === active}
            data-index={i}
          >
            <button
              type="button"
              tabIndex={-1}
              disabled={status === "searching"}
              onClick={() => open(match)}
              onMouseMove={() => setActive(i)}
              className={`w-full rounded-md p-3 text-left hover:bg-hover focus-self disabled:opacity-50 ${i === active ? "bg-selected" : ""}`}
            >
              <span className="block text-sm text-fg">{match.title}</span>
              <span className="mt-1 block text-xs text-fg-secondary">{match.scapeName}</span>
              <span className="mt-1 block break-words text-xs text-fg-tertiary">
                {match.excerpt}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
