import { useEffect, useState } from "react";
import type { ActionPayload } from "@/core/actions";
import { fixtureScape } from "@/core/fixtures";
import { allPlugins, getPlugin } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import type { Scape, ScapeObject } from "@/core/types";
import { Link } from "@/app/router";

/**
 * Workstream D's harness. Exercises every plugin against the fixture with no dependency on
 * the canvas, persistence or AI.
 *
 * The card here is a plain preview box on purpose — real node chrome (border, type bar, id)
 * belongs to the canvas, and duplicating it here would let the two drift apart unnoticed.
 */

function overfullObjects(): ScapeObject[] {
  const base = { x: 0, y: 0, createdAt: 0, updatedAt: 0 };
  return [
    {
      ...base,
      id: "overfull-note",
      type: "note",
      title: "A note with far more body than fits",
      data: {
        body:
          "This paragraph exists to prove the body clamps at three lines. " +
          "It keeps going well past that. ".repeat(20),
      },
    },
    {
      ...base,
      id: "overfull-journey",
      type: "journey",
      title: "A forty-step journey",
      data: {
        steps: Array.from({ length: 40 }, (_, i) => ({
          id: `s${i}`,
          label: `Step ${i + 1}: something the user does at this point in the flow`,
          detail: "A supporting detail that would blow the node out if it were rendered.",
        })),
      },
    },
    {
      ...base,
      id: "overfull-wireframe",
      type: "wireframe",
      title: "A thirty-element wireframe",
      data: {
        primitives: Array.from({ length: 30 }, (_, i) => ({
          id: `p${i}`,
          kind: (["box", "text", "input", "button", "list"] as const)[i % 5],
          label: `Element ${i + 1}`,
          span: [12, 6, 4, 3][i % 4],
        })),
      },
    },
  ];
}

function seed(): Scape {
  const scape = fixtureScape();
  for (const object of overfullObjects()) {
    scape.objects[object.id] = object;
    scape.objectOrder.push(object.id);
  }
  return scape;
}

export function DevObjects() {
  const scape = useScapeStore((s) => s.scape);
  const dispatchTx = useScapeStore((s) => s.dispatchTx);
  const [selectedId, setSelectedId] = useState<string>("brief");

  useEffect(() => {
    useScapeStore.getState().loadScape(seed());
  }, []);

  if (!scape) return null;

  const representative = allPlugins().map((p) =>
    scape.objectOrder.map((id) => scape.objects[id]).find((o) => o.type === p.type)!,
  );
  const overfull = ["overfull-note", "overfull-journey", "overfull-wireframe"].map(
    (id) => scape.objects[id],
  );
  const selected = scape.objects[selectedId];

  return (
    <div className="flex h-full bg-base">
      <div className="min-w-0 flex-1 overflow-auto px-8 py-8">
        <header className="mb-8">
          <Link to="/dev" className="mono">
            ← dev
          </Link>
          <div className="mt-2 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl text-fg">Object plugins</h1>
              <p className="mt-1 text-fg-secondary">
                {allPlugins().length} types discovered by glob. Click a card to edit it in the
                inspector; the preview updates as you type.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <Section title="Fixture objects · 1×" caption="one card per registered type">
          <Row objects={representative} onSelect={setSelectedId} selectedId={selectedId} />
        </Section>

        <Section
          title="Fixture objects · 0.4×"
          caption="body text drops out rather than turning to mush"
        >
          <Row
            objects={representative}
            onSelect={setSelectedId}
            selectedId={selectedId}
            scale={0.4}
          />
        </Section>

        <Section title="Over-full instances · 1×" caption="node height must not grow with content">
          <Row objects={overfull} onSelect={setSelectedId} selectedId={selectedId} />
        </Section>
      </div>

      <aside className="w-[320px] shrink-0 overflow-auto border-l border-subtle bg-surface p-4">
        {selected ? (
          <Inspector object={selected} dispatch={(p) => dispatchTx([p])} />
        ) : (
          <p className="text-fg-tertiary">Nothing selected.</p>
        )}
      </aside>
    </div>
  );
}

function Inspector({
  object,
  dispatch,
}: {
  object: ScapeObject;
  dispatch: (payload: ActionPayload) => void;
}) {
  const plugin = getPlugin(object.type);
  if (!plugin) return <p className="mono">unregistered · {object.type}</p>;
  return (
    <>
      <p className="mono mb-3">{object.id}</p>
      <plugin.Inspector object={object} dispatch={dispatch} />
    </>
  );
}

/**
 * Flips the real `.dark` class on <html>, rather than rendering a light and a dark section
 * side by side. tokens.css declares the light tier-2 values on `:root` and the dark ones on
 * `.dark`, with no `.light` counterpart — so there is no way to opt a subtree back into light
 * inside a dark document without restating the token values somewhere, which is exactly what
 * the design system forbids. Toggling the document exercises the shipping mechanism anyway.
 */
function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    setDark(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="mono shrink-0 rounded-full border border-subtle px-3 py-1.5 transition-colors duration-instant ease-out hover:bg-hover"
    >
      {dark ? "dark" : "light"}
    </button>
  );
}

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="text-lg text-fg">{title}</h2>
        <span className="mono">{caption}</span>
      </div>
      <div className="rounded-lg bg-canvas p-5">{children}</div>
    </section>
  );
}

function Row({
  objects,
  scale = 1,
  selectedId,
  onSelect,
}: {
  objects: ScapeObject[];
  scale?: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      // Below ~0.6x, 12px body text renders under 8px. The canvas sets this same attribute.
      data-lod={scale < 0.6 ? "low" : "high"}
      className="flex flex-wrap items-start gap-4"
      style={{ zoom: scale }}
    >
      {objects.map((object) => (
        <PreviewCard
          key={object.id}
          object={object}
          selected={object.id === selectedId}
          onSelect={() => onSelect(object.id)}
        />
      ))}
    </div>
  );
}

function PreviewCard({
  object,
  selected,
  onSelect,
}: {
  object: ScapeObject;
  selected: boolean;
  onSelect: () => void;
}) {
  const plugin = getPlugin(object.type);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "w-[220px] rounded-lg bg-surface p-3 text-left shadow-sm transition-shadow " +
        "duration-fast ease-out " +
        (selected ? "ring-2 ring-accent" : "")
      }
    >
      <div
        className="mb-2 h-0.5 w-full rounded-full"
        style={{ background: plugin ? `var(${plugin.color})` : "var(--border-strong)" }}
      />
      {plugin ? (
        <plugin.Node object={object} selected={selected} />
      ) : (
        <p className="mono">unregistered · {object.type}</p>
      )}
      <p className="mono mt-2">{object.id}</p>
    </button>
  );
}
