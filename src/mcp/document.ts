import type { Scape } from "../core/types";
import { actionSchema, type Action, type ActionPayload } from "../core/actions";
import { applyAction } from "../core/reducer";
import { objectSchemas, changeSchema } from "./contracts";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
export function revision(scape: Scape) {
  const { viewState: _v, updatedAt: _u, createdAt: _c, ...content } = scape;
  return digest(content);
}
export function validateChanges(scape: Scape, input: unknown[], allowedTypes: string[] = []) {
  let next = scape;
  const actions: ActionPayload[] = [];
  for (const raw of input) {
    const a = changeSchema.parse(raw) as ActionPayload;
    if (a.type === "CreateObject") {
      if (Object.hasOwn(next.objects, a.id) || ["__proto__", "constructor", "prototype"].includes(a.id)) throw new Error(`duplicate_id: ${a.id}`);
      if (allowedTypes.length && !allowedTypes.includes(a.objectType)) throw new Error(`unsupported_type: ${a.objectType}`);
    } else if (a.type === "UpdateObject" || a.type === "DeleteObject") {
      if (!Object.hasOwn(next.objects, a.id)) throw new Error(`not_found: ${a.id}`);
    } else if (a.type === "ConnectObjects") {
      if (Object.hasOwn(next.relationships, a.id)) throw new Error(`duplicate_id: ${a.id}`);
      if (!Object.hasOwn(next.objects, a.from) || !Object.hasOwn(next.objects, a.to) || a.from === a.to) throw new Error("invalid_relationship");
    } else if (a.type === "DisconnectObjects" && !Object.hasOwn(next.relationships, a.id)) throw new Error(`not_found: ${a.id}`);
    if (a.type === "UpdateObject" && a.patch.data) {
      const schema = objectSchemas[next.objects[a.id].type as keyof typeof objectSchemas];
      if (!schema) throw new Error("unsupported_type");
      a.patch.data = schema.parse(a.patch.data);
    }
    const stamped = actionSchema.parse({ ...a, txId: "preview", ts: scape.updatedAt });
    next = applyAction(next, stamped).state;
    actions.push(a);
  }
  return { actions, state: next };
}
export function applyBatch(scape: Scape, payloads: ActionPayload[], txId: string) {
  let next = scape;
  const actions: Action[] = [], inverses: Action[] = [];
  for (const payload of payloads) {
    const action = actionSchema.parse({ ...payload, ts: Date.now(), txId });
    const result = applyAction(next, action);
    if (result.inverse) { next = result.state; actions.push(action); inverses.unshift(result.inverse); }
  }
  return { state: next, actions, inverses };
}
