import { useEffect, useState } from "react";
import { notify } from "@/core/notify";
import type { ScapeSummary } from "@/core/types";
import { Button } from "@/design/Button";
import { Select } from "@/design/Select";
import { MAX_CAPTURE_LENGTH, workspaceRepository, type Capture } from "@/persistence/workspace";
import { setPendingFocus } from "../pending";
import { navigate, scapeRoute } from "../router";
import { openWorkspaceTool } from "../workspaceEvents";
import { relativeTime } from "./library";

export function InboxPage({
  scapes,
  onChanged,
}: {
  scapes: ScapeSummary[];
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Capture[]>([]);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = () => {
    void workspaceRepository
      .listCaptures()
      .then(setItems)
      .catch(() => notify.error("Could not load Inbox", "Try reopening Inbox."))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    refresh();
    window.addEventListener("precipice:library-changed", refresh);
    return () => window.removeEventListener("precipice:library-changed", refresh);
  }, []);
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-pixel text-2xl">Inbox</h1>
          <p className="mt-2 text-sm text-fg-secondary">Notes to develop or add to a scape.</p>
        </div>
        <Button variant="primary" onClick={() => openWorkspaceTool("capture")}>
          Capture a note
        </Button>
      </div>
      <div className="mt-8 flex gap-3" role="group" aria-label="Inbox view">
        <Button
          aria-pressed={!archived}
          className={!archived ? "workspace-selected bg-selected text-fg" : ""}
          variant={archived ? "ghost" : "secondary"}
          onClick={() => setArchived(false)}
        >
          Inbox
        </Button>
        <Button
          aria-pressed={archived}
          className={archived ? "workspace-selected bg-selected text-fg" : ""}
          variant={archived ? "secondary" : "ghost"}
          onClick={() => setArchived(true)}
        >
          Archived
        </Button>
      </div>
      {loading ? (
        <p className="mt-6 text-sm text-fg-secondary" role="status">
          Loading Inbox…
        </p>
      ) : (
        <ul className="mt-4 grid max-w-4xl items-start gap-4 lg:grid-cols-2">
          {items
            .filter((item) => item.archived === archived)
            .map((item) => (
              <InboxItem
                key={item.id + item.updatedAt}
                item={item}
                scapes={scapes}
                onChanged={() => {
                  refresh();
                  onChanged();
                }}
              />
            ))}
        </ul>
      )}
      {!loading && !items.some((item) => item.archived === archived) && (
        <p className="mt-8 text-sm text-fg-secondary">
          {archived
            ? "No archived notes."
            : "No notes in Inbox. Capture a note without choosing a template or connecting AI."}
        </p>
      )}
    </section>
  );
}

function InboxItem({
  item,
  scapes,
  onChanged,
}: {
  item: Capture;
  scapes: ScapeSummary[];
  onChanged: () => void;
}) {
  const [text, setText] = useState(item.text);
  const [editing, setEditing] = useState(false);
  const [destination, setDestination] = useState("");
  const [choosingDestination, setChoosingDestination] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
      onChanged();
    } catch (error) {
      notify.error(
        "Could not update Inbox",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusy(false);
    }
  };
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The destination may have been deleted since; never offer a link that leads nowhere.
  const destinationExists = !!item.promotedTo && scapes.some((s) => s.id === item.promotedTo);
  const open = (scapeId: string, objectId?: string) => {
    if (objectId) setPendingFocus(scapeId, objectId);
    navigate(scapeRoute(scapeId));
  };
  return (
    <li className="min-w-0 rounded-lg border border-default bg-surface p-5 text-fg">
      <div className="mb-4 flex items-center justify-between gap-3">
        <time
          className="text-xs text-fg-tertiary"
          dateTime={new Date(item.createdAt).toISOString()}
        >
          {relativeTime(item.createdAt)}
        </time>
        <div className="flex items-center gap-1">
          {item.archived &&
            (confirmingDelete ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => workspaceRepository.deleteCapture(item.id))}
                >
                  Delete permanently
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            ))}
          {!confirmingDelete && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || editing}
              onClick={() =>
                void run(() =>
                  workspaceRepository.updateCapture(item.id, { archived: !item.archived }),
                )
              }
            >
              {item.archived ? "Restore to Inbox" : "Archive"}
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-24">
        {editing ? (
          <textarea
            aria-label="Edit Inbox note"
            rows={5}
            value={text}
            maxLength={MAX_CAPTURE_LENGTH}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded-md border border-default bg-inset p-3 text-base text-fg placeholder:text-fg-tertiary selection:bg-selected selection:text-fg focus-self"
          />
        ) : (
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-fg">
            {item.text}
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {item.promotedTo ? (
          destinationExists ? (
            <Button disabled={busy} onClick={() => open(item.promotedTo!, item.objectId)}>
              Open scape
            </Button>
          ) : (
            <p className="text-xs text-fg-secondary">
              The scape this note was added to has been deleted. Restore it to Inbox to reuse it.
            </p>
          )
        ) : (
          <>
            {editing ? (
              <Button
                disabled={busy || !text.trim()}
                onClick={() =>
                  void run(async () => {
                    await workspaceRepository.updateCapture(item.id, { text });
                    setEditing(false);
                  })
                }
              >
                Save note
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setChoosingDestination(false);
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            )}
            {editing && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setText(item.text);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            )}
            {!item.archived && !editing && (
              <Button
                size="sm"
                className="ml-auto"
                disabled={busy}
                aria-expanded={choosingDestination}
                onClick={() => setChoosingDestination(!choosingDestination)}
              >
                Add to scape
              </Button>
            )}
          </>
        )}
      </div>
      {choosingDestination && !item.archived && !item.promotedTo && !editing && (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <span className="w-full text-xs text-fg-secondary">Add this note to</span>
          <Select
            label={`Destination for ${item.text.slice(0, 40)}`}
            value={destination}
            onChange={setDestination}
            disabled={busy || editing}
            options={[
              { value: "", label: "New scape" },
              ...scapes.map((s) => ({ value: s.id, label: s.name })),
            ]}
            className="min-w-0 flex-1"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={busy || editing}
            onClick={() =>
              void run(async () => {
                const target = await workspaceRepository.promote(item.id, destination || undefined);
                open(target.scapeId, target.objectId);
              })
            }
          >
            {busy ? "Adding…" : "Add note"}
          </Button>
        </div>
      )}
    </li>
  );
}
