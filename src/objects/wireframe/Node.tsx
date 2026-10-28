import { useState } from "react";
import type { ScapeObject } from "@/core/types";
import { useCanvasReadOnly } from "@/canvas/readOnly";
import { InlineTitle } from "../InlineTitle";
import { WireframeBody } from "./Body";

/**
 * The editable card. Display lives in `Body.tsx`, which the public viewer also renders — this
 * file is the title's editing state and the dispatch around it, and nothing else. The
 * primitives have never been editable on the card; they belong to the inspector.
 */
export function WireframeNode({ object, selected }: { object: ScapeObject; selected: boolean }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const readOnly = useCanvasReadOnly();

  return (
    <WireframeBody
      object={object}
      {...(readOnly || !selected ? {} : { onEdit: () => setEditingTitle(true) })}
      {...(editingTitle
        ? {
            renderTitle: (
              <InlineTitle
                id={object.id}
                title={object.title}
                readOnly={readOnly}
                onDone={() => setEditingTitle(false)}
              />
            ),
          }
        : {})}
    />
  );
}
