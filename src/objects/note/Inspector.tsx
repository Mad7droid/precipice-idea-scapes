import type { ActionPayload } from "@/core/actions";
import type { ScapeObject } from "@/core/types";
import { Field, RichTextEditor, SectionHeader, TextInput, useDebouncedText } from "../ui";
import type { NoteData } from "./schema";

export function NoteInspector({
  object,
  dispatch,
}: {
  object: ScapeObject;
  dispatch: (payload: ActionPayload) => void;
}) {
  const data = object.data as Partial<NoteData>;

  const [title, setTitle, flushTitle] = useDebouncedText(object.title, (next) =>
    dispatch({ type: "UpdateObject", id: object.id, patch: { title: next } }),
  );

  const [body, setBody, flushBody] = useDebouncedText(data.body ?? "", (next) =>
    dispatch({ type: "MergeObjectData", id: object.id, data: { body: next } }),
  );

  return (
    <div>
      <SectionHeader>note</SectionHeader>
      <div className="space-y-3">
        <Field label="Title">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={flushTitle}
            placeholder="Untitled"
          />
        </Field>
        <Field label="Body">
          <RichTextEditor
            value={body}
            onChange={setBody}
            onBlur={flushBody}
            placeholder="What is worth writing down?"
          />
        </Field>
      </div>
    </div>
  );
}
