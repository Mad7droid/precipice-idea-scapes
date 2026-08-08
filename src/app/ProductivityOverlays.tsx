import { useEffect, useMemo, useRef, useState } from "react";

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  run: () => void;
}

export function CommandPalette({ items, onClose }: { items: CommandItem[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term
      ? items.filter((item) => `${item.label} ${item.hint ?? ""}`.toLowerCase().includes(term))
      : items;
  }, [items, query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActive(0), [query]);

  const choose = (item: CommandItem | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-modal grid place-items-start bg-black/30 pt-[18vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Command palette"
        className="w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-xl border border-subtle bg-surface shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commands"
          aria-label="Search commands"
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, matches.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              choose(matches[active]);
            }
          }}
          className="focus-self w-full border-b border-subtle bg-transparent px-4 py-3 text-fg placeholder:text-fg-tertiary"
        />
        <div className="max-h-[320px] overflow-auto p-1">
          {matches.length === 0 ? (
            <p className="px-3 py-5 text-sm text-fg-tertiary">No matching commands.</p>
          ) : (
            matches.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item)}
                className={
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-instant ease-out " +
                  (index === active ? "bg-hover" : "hover:bg-hover")
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-fg">{item.label}</span>
                  {item.hint && <span className="block text-xs text-fg-tertiary">{item.hint}</span>}
                </span>
                {item.shortcut && (
                  <kbd className="mono shrink-0 normal-case tracking-normal">{item.shortcut}</kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const SHORTCUT_GROUPS = [
  {
    title: "Create & edit",
    shortcuts: [
      ["Tab", "Extend the selected thought to the right"],
      ["⇧Tab", "Add a connected predecessor to the left"],
      ["Enter", "Edit the selected object's title"],
      ["⌘D", "Duplicate selection"],
      ["N · J · W", "Add a Note, Journey, or Wireframe"],
    ],
  },
  {
    title: "Move & view",
    shortcuts: [
      ["Arrows / ⇧Arrows", "Nudge / move farther"],
      ["⌥Arrows", "Select the nearest object in that direction"],
      ["0 / ⇧1", "Reset zoom / fit canvas"],
    ],
  },
  {
    title: "Commands & AI",
    shortcuts: [
      ["⌘↵", "Send AI prompt"],
      ["⌘K", "Open commands"],
      ["Esc", "Clear selection or close a menu"],
    ],
  },
];

const HOW_TO = [
  {
    title: "Start a scape",
    body: "Choose a starting shape on Home, describe what you want to explore, or open a blank canvas. Your work stays in this browser unless you export it.",
  },
  {
    title: "Build the map",
    body: "Use the + button, N, J, or W to add objects. Drag an object's connection handle into open space to add and connect a new block in one gesture.",
  },
  {
    title: "Shape the idea",
    body: "Select a block to edit it in the inspector. Drag to place it, use the outline to find it, and use Tidy when you want a clean overall arrangement.",
  },
  {
    title: "Work with AI",
    body: "Ask for a first draft, an expansion, or a different angle from the composer. Review every result on the canvas, then keep adjusting it directly.",
  },
];

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<"how-to" | "shortcuts">("how-to");
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-modal grid place-items-center bg-black/30 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Help and keyboard shortcuts"
        className="w-[min(560px,100%)] overflow-hidden rounded-xl border border-subtle bg-surface shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
          <div>
            <h2 className="text-lg text-fg">Help</h2>
            <p className="mt-1 text-xs text-fg-secondary">
              A quick guide to building and navigating a scape.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close shortcuts"
            onClick={onClose}
            className="rounded-sm px-1 text-fg-tertiary transition-colors duration-instant ease-out hover:text-fg"
          >
            ✕
          </button>
        </div>
        <div className="flex border-b border-subtle px-5" role="tablist" aria-label="Help sections">
          {[
            ["how-to", "Getting started"],
            ["shortcuts", "Keyboard shortcuts"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              onClick={() => setSection(id as "how-to" | "shortcuts")}
              className={
                "border-b-2 px-3 py-2 text-sm transition-colors duration-instant ease-out " +
                (section === id
                  ? "border-fg text-fg"
                  : "border-transparent text-fg-tertiary hover:text-fg-secondary")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="max-h-[min(460px,60vh)] overflow-auto px-5 py-4">
          {section === "how-to" ? (
            <ol className="space-y-4">
              {HOW_TO.map((item, index) => (
                <li key={item.title} className="flex gap-3">
                  <span className="mono mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-subtle text-[10px] text-fg-secondary">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-sm text-fg">{item.title}</h3>
                    <p className="mt-1 text-sm leading-5 text-fg-secondary">{item.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="space-y-5">
              <p className="text-xs text-fg-tertiary">
                Canvas commands are inactive while you type.
              </p>
              {SHORTCUT_GROUPS.map((group) => (
                <section key={group.title}>
                  <h3 className="mono mb-1 text-fg-tertiary">{group.title}</h3>
                  <dl className="divide-y divide-subtle">
                    {group.shortcuts.map(([keys, description]) => (
                      <div key={keys} className="flex items-center justify-between gap-5 py-2">
                        <dt className="text-sm text-fg-secondary">{description}</dt>
                        <dd>
                          <kbd className="mono whitespace-nowrap normal-case tracking-normal">
                            {keys}
                          </kbd>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
