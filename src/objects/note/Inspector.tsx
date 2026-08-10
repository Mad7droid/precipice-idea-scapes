import type { ActionPayload } from "@/core/actions";
import type { ScapeObject } from "@/core/types";
import { Field, SectionHeader, TextArea, TextInput, useDebouncedText } from "../ui";
import type { NoteData } from "./schema";

export function NoteInspector({
  object,
  dispatch,
}: {
  object: ScapeObject;
  dispatch: (payload: ActionPayload) => void;
}) {
  const data = object.data as Partial<NoteData>;

  const [title, setTitle] = useDebouncedText(object.title, (next) =>
    dispatch({ type: "UpdateObject", id: object.id, patch: { title: next } }),
  );

  const [body, setBody] = useDebouncedText(data.body ?? "", (next) =>
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
            placeholder="Untitled"
          />
        </Field>
        <Field label="Body">
          <TextArea
            value={body}
            rows={10}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What is worth writing down?"
          />
        </Field>
      </div>
    </div>
  );
}
