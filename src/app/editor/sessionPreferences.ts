import { z } from "zod";

const schema = z.object({
  leftWidth: z.number().finite().min(260).max(440).optional(),
  rightWidth: z.number().finite().min(260).max(440).optional(),
  leftCollapsed: z.boolean().optional(),
  rightCollapsed: z.boolean().optional(),
  scapiOpen: z.boolean().optional(),
  selection: z.array(z.string().max(200)).max(100).optional(),
});
export type EditorPreferences = z.infer<typeof schema>;
const key = (id: string) => `precipice.editor.session.${id}`;
export function readEditorPreferences(id: string): EditorPreferences {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(key(id)) ?? "{}"));
  } catch {
    return {};
  }
}
export function saveEditorPreferences(id: string, value: EditorPreferences): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(schema.parse(value)));
  } catch {
    /* optional metadata only */
  }
}
/** Draft text is tab-session only. Never put it in durable preferences or portable files. */
export function readEditorDraft(id: string): string {
  try {
    return (sessionStorage.getItem(`${key(id)}.draft`) ?? "").slice(0, 20000);
  } catch {
    return "";
  }
}
export function saveEditorDraft(id: string, text: string): void {
  try {
    if (text) sessionStorage.setItem(`${key(id)}.draft`, text.slice(0, 20000));
    else sessionStorage.removeItem(`${key(id)}.draft`);
  } catch {
    /* a draft stays in memory when session storage is unavailable */
  }
}
/** Called when a scape is deleted so its layout, selection and draft do not outlive it. */
export function clearEditorSession(id: string): void {
  try {
    localStorage.removeItem(key(id));
    sessionStorage.removeItem(`${key(id)}.draft`);
  } catch {
    /* storage unavailable: nothing was stored */
  }
}
