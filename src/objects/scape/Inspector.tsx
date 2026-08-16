import type { ActionPayload } from "@/core/actions";
import type { ScapeObject } from "@/core/types";
import { Field, RichTextEditor, SectionHeader, TextInput, useDebouncedText } from "../ui";
import type { ScapeBlockData } from "./schema";

export function ScapeBlockInspector({
  object,
  dispatch,
}: {
  object: ScapeObject;
  dispatch: (payload: ActionPayload) => void;
}) {
  const data = object.data as Partial<ScapeBlockData>;

  const [title, setTitle, flushTitle] = useDebouncedText(object.title, (next) =>
    dispatch({ type: "UpdateObject", id: object.id, patch: { title: next } }),
  );

  const [body, setBody, flushBody] = useDebouncedText(data.body ?? "", (next) =>
    dispatch({ type: "MergeObjectData", id: object.id, data: { body: next } }),
  );

  return (
    <div>
      <SectionHeader>scape block</SectionHeader>
      <div className="space-y-3">
        <Field label="Title">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={flushTitle}
            placeholder="Untitled"
          />
        </Field>
        <Field label="Document">
          <RichTextEditor
            value={body}
            onChange={setBody}
            onBlur={flushBody}
            className="min-h-64"
            placeholder="# Heading&#10;&#10;Headings, tables and lists all render."
          />
        </Field>
      </div>
    </div>
  );
}
