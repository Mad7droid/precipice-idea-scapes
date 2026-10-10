import type { Action, ActionPayload } from "@/core/actions";
import { applyAction } from "@/core/reducer";
import { newTxId, newScapeId } from "@/core/ids";
import { emptyScape } from "@/core/fixtures";
import type { ObjectId, Scape, ScapeSummary } from "@/core/types";
import { layoutAction } from "@/canvas/layout";
import type { LayoutMode } from "@/starters";
import { actionSchema } from "@/core/actions";
import {
  LIMITS,
  approvalTools,
  byteLength,
  failure,
  toolSchemas,
  writes,
  type Envelope,
  type Grant,
  type McpOperation,
  type Outcome,
} from "./contracts";
import { applyBatch, digest, revision, validateChanges } from "./document";

/**
 * The browser-side MCP command service.
 *
 * Every MCP transport — the hosted relay, the desktop's local socket — ends here, and this is
 * the only place an agent's request turns into a read or a write. Writes go through
 * `applyAction` (via the open editor's store when the scape is open, or straight onto the
 * stored snapshot when it is not), so undo, validation and autosave behave exactly as they do
 * for a person.
 */

export type { Envelope, Grant };

/** A scape open in an editor. Writes must go through it, never around it. */
export interface LiveScape {
  current(): Scape;
  canWrite(): boolean;
  /**
   * Dispatch payloads as one transaction, then (when `layout` is set) lay the result out in the
   * same transaction. The editor is frozen against other edits for the duration.
   */
  apply(
    payloads: ActionPayload[],
    txId: string,
    layout: LayoutMode | null,
    operation?: McpOperation,
  ): Promise<{ inverses: Action[] }>;
  focus(ids: ObjectId[]): void;
  selection(): ObjectId[];
}

export interface Library {
  list(): Promise<ScapeSummary[]>;
  get(id: string): Promise<Scape | undefined>;
  create(name: string): Promise<Scape>;
  duplicate(id: string): Promise<Scape>;
  remove(id: string): Promise<void>;
  /** Snapshot, logged actions and receipt commit together, or not at all. */
  commit(operation: McpOperation, scape?: Scape, actions?: Action[]): Promise<void>;
}

export interface Operations {
  get(key: string): Promise<McpOperation | undefined>;
  put(operation: McpOperation): Promise<void>;
  forScape(scapeId: string, offset: number, limit: number): Promise<McpOperation[]>;
}

export interface ServiceDeps {
  library: Library;
  operations: Operations;
  /** The editor holding this scape in this tab, if any. */
  live(scapeId: string): LiveScape | null;
  /** Is some *other* tab editing this scape? Such scapes are routed there, not written here. */
  isOpen?(scapeId: string): boolean;
  /** Ask the person to confirm. Called for review-mode batches and approval tools. */
  requestReview(operation: McpOperation): void;
  /** Object types, their guidance and default data, for get_capabilities. */
  capabilities(): { type: string; hint: string; example: unknown }[];
  markdown(scape: Scape): string;
  now?: () => number;
  publish?(scape: Scape, withdraw: boolean): Promise<Record<string, unknown>>;
  sharePreview?(
    scape: Scape,
    existing?: string,
    withdraw?: boolean,
  ): Promise<Record<string, unknown>>;
}

const ok = (body: Record<string, unknown> = {}): Outcome => ({ status: "ok", ...body });

function allowedScape(grant: Grant, scapeId: string) {
  return grant.scapes === "all" || grant.scapes.includes(scapeId);
}

function operationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `op_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function objectView(scape: Scape, id: string) {
  const object = scape.objects[id];
  if (!object) return null;
  const relationships = Object.values(scape.relationships).filter(
    (r) => r.from === id || r.to === id,
  );
  return {
    id: object.id,
    type: object.type,
    title: object.title,
    data: object.data,
    ...(object.tags?.length ? { tags: object.tags } : {}),
    relationships: relationships.map((r) => ({
      id: r.id,
      from: r.from,
      to: r.to,
      ...(r.label ? { label: r.label } : {}),
    })),
  };
}

function summaryOf(scape: Scape) {
  const types: Record<string, number> = {};
  for (const id of scape.objectOrder) {
    const type = scape.objects[id]?.type;
    if (type) types[type] = (types[type] ?? 0) + 1;
  }
  return {
    scape_id: scape.id,
    name: scape.name,
    objects: scape.objectOrder.length,
    relationships: Object.keys(scape.relationships).length,
    types,
    updated_at: new Date(scape.updatedAt).toISOString(),
  };
}

function describeError(error: unknown): Outcome {
  const message = error instanceof Error ? error.message : String(error);
  if (error && typeof error === "object" && "issues" in error)
    return failure("invalid_arguments", message.slice(0, 2000));
  const code = message.split(":")[0].trim();
  const known = [
    "duplicate_id",
    "not_found",
    "invalid_relationship",
    "unsupported_type",
    "read_only",
    "commit_in_progress",
  ];
  return failure(known.includes(code) ? code : "failed", message.slice(0, 2000));
}

export function createCommandService(deps: ServiceDeps) {
  const now = deps.now ?? Date.now;

  async function load(scapeId: string): Promise<{ scape: Scape; live: LiveScape | null } | null> {
    const live = deps.live(scapeId);
    if (live) return { scape: live.current(), live };
    const scape = await deps.library.get(scapeId);
    return scape ? { scape, live: null } : null;
  }

  function receipt(
    envelope: Envelope,
    scapeId: string,
    key: string,
    fingerprint: string,
    result: Outcome,
  ): McpOperation {
    return {
      key,
      scapeId,
      command: {
        id: envelope.id,
        tool: envelope.tool,
        args: envelope.args as Record<string, unknown>,
      },
      fingerprint,
      expiresAt: now() + LIMITS.receiptMs,
      result,
    };
  }

  /**
   * Applies validated payloads as one transaction. New objects are laid out in the same
   * transaction, so one undo removes the agent's batch *and* the layout it caused.
   */
  async function commitPayloads(
    target: { scape: Scape; live: LiveScape | null },
    payloads: ActionPayload[],
    operation: McpOperation,
    layout: LayoutMode | null,
  ): Promise<{ state: Scape; inverses: Action[]; revision: string }> {
    const txId = newTxId();
    const creates = payloads.some((p) => p.type === "CreateObject");
    if (target.live) {
      const live = target.live;
      if (!live.canWrite()) throw new Error("read_only");
      const { inverses } = await live.apply(
        payloads,
        txId,
        layout ?? (creates ? "LR" : null),
        operation,
      );
      const state = live.current();
      const rev = await revision(state);
      const done = { ...operation, inverses, afterRevision: rev };
      await deps.operations.put(done);
      Object.assign(operation, done);
      return { state, inverses, revision: rev };
    }
    let { state, actions, inverses } = applyBatch(target.scape, payloads, txId);
    if (layout || creates) {
      const action = actionSchema.parse({
        ...layoutAction(state, layout ?? "LR"),
        txId,
        ts: now(),
      });
      const result = applyAction(state, action);
      if (result.inverse) {
        state = result.state;
        actions = [...actions, action];
        inverses = [result.inverse, ...inverses];
      }
    }
    state = { ...state, updatedAt: now() };
    const rev = await revision(state);
    Object.assign(operation, { inverses, afterRevision: rev });
    operation.result = {
      status: "applied",
      operation_id: operation.key,
      scape_id: operation.scapeId,
      revision: rev,
      message: String(operation.command.args.__summary ?? "Applied."),
    };
    await deps.library.commit(operation, state, actions);
    return { state, inverses, revision: rev };
  }

  /** Runs a write that may need the person first. `payloads` must already be validated. */
  async function write(
    envelope: Envelope,
    scapeId: string,
    target: { scape: Scape; live: LiveScape | null },
    payloads: ActionPayload[],
    summary: string,
    layout: LayoutMode | null = null,
  ): Promise<Outcome> {
    const args = envelope.args as { idempotency_key?: string };
    const key = args.idempotency_key ? `${scapeId}:${args.idempotency_key}` : operationId();
    const fingerprint = await digest({ tool: envelope.tool, args: envelope.args });
    const operation = receipt(envelope, scapeId, key, fingerprint, {
      status: "running",
      operation_id: key,
    });
    operation.command.args = {
      ...operation.command.args,
      __payloads: payloads,
      __summary: summary,
      __layout: layout,
      __client: envelope.grant.clientName,
      __clientId: envelope.grant.clientId,
    };
    if (envelope.grant.mode === "review" || approvalTools.has(envelope.tool)) {
      operation.result = {
        status: "awaiting_review",
        operation_id: key,
        message: `Waiting for the person to review this in Precipice: ${summary}`,
      };
      operation.expiresAt = now() + LIMITS.reviewMs;
      await deps.operations.put(operation);
      deps.requestReview(operation);
      return operation.result;
    }
    const done = await commitPayloads(target, payloads, operation, layout);
    operation.result = {
      status: "applied",
      operation_id: key,
      revision: done.revision,
      message: summary,
    };
    await deps.operations.put(operation);
    return operation.result;
  }

  /** Complete or refuse a batch the person reviewed. Returns the final outcome. */
  async function resolveReview(key: string, approve: boolean): Promise<Outcome> {
    const operation = await deps.operations.get(key);
    if (!operation || operation.result.status !== "awaiting_review")
      return failure("not_found", "That request is no longer awaiting review.");
    if (operation.expiresAt <= now()) {
      operation.result = failure(
        "expired",
        "This review expired. Ask the agent to propose the change again.",
      );
      await deps.operations.put(operation);
      return operation.result;
    }
    if (!approve) {
      operation.result = {
        status: "rejected",
        operation_id: key,
        message: "The person declined this change.",
      };
      await deps.operations.put(operation);
      return operation.result;
    }
    try {
      const args = operation.command.args as {
        __payloads?: ActionPayload[];
        __summary?: string;
        __layout?: LayoutMode | null;
      };
      if (operation.command.tool === "delete_scape") {
        await deps.library.remove(operation.scapeId);
        operation.result = { status: "applied", operation_id: key, message: "Scape deleted." };
        await deps.operations.put(operation);
        return operation.result;
      }
      const target = await load(operation.scapeId);
      if (!target) throw new Error("not_found: scape");
      if (
        operation.command.tool === "publish_scape" ||
        operation.command.tool === "unpublish_scape"
      ) {
        if (!deps.publish) throw new Error("Publishing is unavailable on this host.");
        const published = await deps.publish(
          target.scape,
          operation.command.tool === "unpublish_scape",
        );
        operation.result = { status: "applied", operation_id: key, ...published };
        await deps.operations.put(operation);
        return operation.result;
      }
      // Re-validate against the document as it is now; the person may have edited meanwhile.
      const payloads = args.__payloads ?? [];
      const actions =
        operation.command.tool === "apply_changes"
          ? validateChanges(target.scape, payloads).actions
          : payloads;
      const done = await commitPayloads(target, actions, operation, args.__layout ?? null);
      operation.result = {
        status: "applied",
        operation_id: key,
        revision: done.revision,
        message: args.__summary ?? "Applied.",
      };
    } catch (error) {
      operation.result = { ...describeError(error), operation_id: key };
    }
    await deps.operations.put(operation);
    return operation.result;
  }

  async function execute(envelope: Envelope): Promise<Outcome> {
    const { tool, grant } = envelope;
    const schema = toolSchemas[tool];
    if (!schema) return failure("unknown_tool", `Unknown tool ${String(tool)}.`);
    if (writes.has(tool) && !grant.write)
      return failure(
        "forbidden",
        "This connection is read-only. Reconnect with edit access in Precipice.",
      );
    let args: Record<string, any>;
    try {
      args = schema.parse(envelope.args ?? {}) as Record<string, any>;
    } catch (error) {
      return describeError(error);
    }
    envelope = { ...envelope, args };
    try {
      return await run(envelope, args);
    } catch (error) {
      return describeError(error);
    }
  }

  async function run(envelope: Envelope, args: Record<string, any>): Promise<Outcome> {
    const { tool, grant } = envelope;

    if (tool === "preview_flow") {
      if (args.scape_id ? !allowedScape(grant, args.scape_id) : grant.scapes !== "all")
        return failure("not_found", "This connection cannot preview that target.");
      const target = args.scape_id ? await load(args.scape_id) : null;
      if (args.scape_id && !target) return failure("not_found", "No such scape.");
      const base = target?.scape ?? {
        ...emptyScape(newScapeId(), args.name),
        createdAt: now(),
        updatedAt: now(),
      };
      const { actions, state } = validateChanges(base, args.actions);
      const laidOut = actions.some((a) => a.type === "CreateObject")
        ? applyAction(
            state,
            actionSchema.parse({ ...layoutAction(state, "LR"), txId: "preview", ts: now() }),
          ).state
        : state;
      const key = operationId();
      const token = operationId();
      const operation = receipt(envelope, base.id, key, await digest(actions), {
        status: "preview",
        operation_id: key,
        scape_id: base.id,
        message: summarizeChanges(actions),
      });
      operation.expiresAt = now() + LIMITS.reviewMs;
      operation.command.args = {
        __payloads: actions,
        __base: args.scape_id ? undefined : base,
        __revision: await revision(base),
        __preview: laidOut,
        __token: token,
        __clientId: grant.clientId,
        __host: grant.host,
        __summary: summarizeChanges(actions),
      };
      const preview = {
        name: laidOut.name,
        target: args.scape_id ? "existing" : "new",
        objects: laidOut.objectOrder.map((id) => {
          const o = laidOut.objects[id];
          return { id: o.id, type: o.type, title: o.title, data: o.data, x: o.x, y: o.y };
        }),
        relationships: Object.values(laidOut.relationships),
      };
      if (byteLength(preview) > LIMITS.bytes)
        return failure("too_large", "This preview is too large for chat. Use smaller batches.");
      await deps.operations.put(operation);
      return {
        ...operation.result,
        objects: preview.objects.length,
        relationships: preview.relationships.length,
        // UI-only metadata: never duplicate flow content or the capability in model context.
        _meta: {
          preview,
          confirmation_token: token,
          expires_at: operation.expiresAt,
          can_write: grant.write,
        },
      };
    }

    if (tool === "confirm_flow" || tool === "share_flow_preview") {
      const op = await deps.operations.get(args.preview_id);
      if (
        !op ||
        op.command.tool !== "preview_flow" ||
        op.scapeId !== args.scape_id ||
        op.command.args.__clientId !== grant.clientId ||
        op.command.args.__host !== grant.host ||
        op.command.args.__token !== args.confirmation_token ||
        !allowedScape(grant, op.scapeId) ||
        (op.command.args.__base && grant.scapes !== "all")
      )
        return failure("not_found", "No matching preview for this connection.");
      const data = op.command.args;
      if (tool === "share_flow_preview") {
        // Withdrawal remains available after the creation draft expires.
        if (!args.withdraw && op.expiresAt <= now())
          return failure("expired", "Preview expired. Ask for a fresh preview.");
        if (!args.withdraw && op.result.status === "cancelled")
          return failure("cancelled", "This preview was discarded.");
        if (!deps.sharePreview)
          return failure("unavailable", "Preview sharing is unavailable on this host.");
        if (!args.withdraw && data.__share) return ok(data.__share);
        if (args.withdraw && !data.__share)
          return ok({ message: "This preview is already private." });
        const shared = await deps.sharePreview(
          data.__preview,
          data.__share?.publication_id ?? data.__publicationId,
          args.withdraw,
        );
        data.__publicationId =
          shared.publication_id ?? data.__share?.publication_id ?? data.__publicationId;
        data.__share = args.withdraw ? undefined : shared;
        await deps.operations.put(op);
        return ok(shared);
      }
      if (op.result.status !== "preview") return op.result;
      if (op.expiresAt <= now())
        return failure("expired", "Preview expired. Ask for a fresh preview.");
      if (!args.approve) {
        op.result = {
          status: "cancelled",
          operation_id: op.key,
          message: "Preview discarded. Nothing was created.",
        };
        await deps.operations.put(op);
        return op.result;
      }
      const target = data.__base
        ? { scape: data.__base as Scape, live: null }
        : await load(op.scapeId);
      if (!target) return failure("not_found", "The target scape was removed.");
      if ((await revision(target.scape)) !== data.__revision)
        return failure(
          "revision_conflict",
          "The scape changed after this preview. Ask for a fresh preview before creating it.",
        );
      if (data.__base && (await deps.library.get(op.scapeId)))
        return failure("revision_conflict", "This target already exists.");
      const { actions } = validateChanges(target.scape, data.__payloads);
      // A UI-only capability confirms exactly this bounded content batch. It cannot confirm
      // publishing/deletion requests or accept replacement actions from the caller.
      const done = await commitPayloads(target, actions, op, null);
      op.result = {
        status: "applied",
        operation_id: op.key,
        scape_id: op.scapeId,
        revision: done.revision,
        message: data.__summary,
      };
      await deps.operations.put(op);
      return op.result;
    }

    if (tool === "get_capabilities")
      return ok({
        object_types: deps.capabilities(),
        change_actions: [
          "CreateObject",
          "UpdateObject",
          "DeleteObject",
          "ConnectObjects",
          "DisconnectObjects",
          "RenameScape",
        ],
        limits: { actions_per_batch: LIMITS.actions, objects_per_read: LIMITS.objects },
        apply_mode: grant.mode,
        can_write: grant.write,
      });

    if (tool === "list_scapes") {
      const scapes = (await deps.library.list()).filter((s) => allowedScape(grant, s.id));
      return ok({
        scapes: scapes.slice(0, 100).map((s) => ({
          scape_id: s.id,
          name: s.name,
          objects: s.objectCount,
          relationships: s.relationshipCount,
          updated_at: new Date(s.updatedAt).toISOString(),
          open_in_editor: Boolean(deps.live(s.id) || deps.isOpen?.(s.id)),
        })),
      });
    }

    if (tool === "get_operation" || tool === "cancel_operation") {
      const operation = await deps.operations.get(args.operation_id);
      if (!operation || !allowedScape(grant, operation.scapeId))
        return failure("not_found", "No such operation.");
      if (
        operation.command.tool === "preview_flow" &&
        (operation.command.args.__clientId !== grant.clientId ||
          operation.command.args.__host !== grant.host)
      )
        return failure("not_found", "No matching preview for this connection.");
      if (tool === "cancel_operation") {
        if (operation.result.status !== "awaiting_review")
          return failure("not_cancellable", `The operation is already ${operation.result.status}.`);
        operation.result = { status: "cancelled", operation_id: operation.key };
        await deps.operations.put(operation);
      }
      return operation.command.tool === "preview_flow"
        ? { ...operation.result, _meta: { share: operation.command.args.__share ?? null } }
        : operation.result;
    }

    if (tool === "fetch") {
      const [scapeId, objectId] = String(args.id).split(":");
      if (!allowedScape(grant, scapeId)) return failure("not_found", "No such scape.");
      const target = await load(scapeId);
      if (!target) return failure("not_found", "No such scape.");
      if (objectId) {
        const view = objectView(target.scape, objectId);
        return view ? ok({ object: view }) : failure("not_found", "No such object.");
      }
      return ok({ scape: summaryOf(target.scape), text: deps.markdown(target.scape) });
    }

    if (tool === "create_scape") {
      if (grant.scapes !== "all")
        return failure(
          "forbidden",
          "This connection is limited to specific scapes, so it cannot create new ones.",
        );
      const scape = await deps.library.create(args.name);
      return ok({ scape_id: scape.id, name: scape.name, message: `Created “${scape.name}”.` });
    }

    // Everything below targets one scape.
    const scapeId: string = args.scape_id;
    if (!allowedScape(grant, scapeId))
      return failure("not_found", "No such scape, or this connection may not use it.");
    const target = await load(scapeId);
    if (!target) return failure("not_found", "No such scape.");
    const { scape } = target;

    if (writes.has(tool) && args.expected_revision) {
      const current = await revision(scape);
      if (current !== args.expected_revision)
        return failure(
          "revision_conflict",
          `The scape changed since you read it. Current revision: ${current}. Read it again before editing.`,
        );
    }
    if (writes.has(tool) && args.idempotency_key) {
      const prior = await deps.operations.get(`${scapeId}:${args.idempotency_key}`);
      if (prior) {
        const fingerprint = await digest({ tool, args });
        if (prior.fingerprint !== fingerprint)
          return failure(
            "idempotency_conflict",
            "That idempotency key was used for a different request.",
          );
        return prior.result;
      }
    }

    switch (tool) {
      case "get_scape": {
        const body: Record<string, unknown> = {
          ...summaryOf(scape),
          revision: await revision(scape),
          instructions: scape.instructions?.body ?? "",
          open_in_editor: Boolean(target.live),
        };
        if (args.include_objects) {
          const ids = scape.objectOrder.slice(args.offset, args.offset + args.limit);
          body.objects = ids.map((id) => objectView(scape, id)).filter(Boolean);
          body.next_offset =
            args.offset + args.limit < scape.objectOrder.length ? args.offset + args.limit : null;
        } else {
          body.object_index = scape.objectOrder.slice(0, 200).map((id) => ({
            id,
            type: scape.objects[id]?.type,
            title: scape.objects[id]?.title,
          }));
        }
        return ok(body);
      }
      case "get_objects":
        return ok({
          revision: await revision(scape),
          objects: args.ids.map((id: string) => objectView(scape, id) ?? { id, missing: true }),
        });
      case "get_selection": {
        const ids = target.live?.selection() ?? [];
        return ok({
          open_in_editor: Boolean(target.live),
          objects: ids
            .slice(0, LIMITS.objects)
            .map((id) => objectView(scape, id))
            .filter(Boolean),
        });
      }
      case "search": {
        const needle = String(args.query).toLowerCase();
        const hits = scape.objectOrder
          .map((id) => scape.objects[id])
          .filter(Boolean)
          .filter((o) =>
            `${o.id} ${o.type} ${o.title} ${JSON.stringify(o.data)}`.toLowerCase().includes(needle),
          );
        return ok({
          total: hits.length,
          results: hits.slice(args.offset, args.offset + args.limit).map((o) => ({
            id: `${scape.id}:${o.id}`,
            object_id: o.id,
            type: o.type,
            title: o.title,
          })),
        });
      }
      case "get_instructions":
        return ok({ body: scape.instructions?.body ?? "", revision: await revision(scape) });
      case "export_scape": {
        const content =
          args.format === "markdown"
            ? deps.markdown(scape)
            : JSON.stringify({ format: "precipice.scape", scape });
        if (byteLength(content) > LIMITS.exportBytes)
          return failure(
            "too_large",
            "This scape is too large to export through MCP. Export it from Precipice instead.",
          );
        return ok({ format: args.format, content });
      }
      case "get_history": {
        const rows = await deps.operations.forScape(scapeId, args.offset, args.limit);
        return ok({
          operations: rows.map((row) => ({
            operation_id: row.key,
            tool: row.command.tool,
            status: row.result.status,
            summary: (row.command.args as { __summary?: string }).__summary,
            client: (row.command.args as { __client?: string }).__client,
          })),
        });
      }
      case "preview_changes": {
        const { actions, state } = validateChanges(scape, args.actions);
        return ok({
          valid: true,
          summary: summarizeChanges(actions),
          before: summaryOf(scape),
          after: summaryOf(state),
        });
      }
      case "apply_changes": {
        const { actions } = validateChanges(scape, args.actions);
        return write(envelope, scapeId, target, actions, summarizeChanges(actions));
      }
      case "set_instructions": {
        const version = (scape.instructions?.version ?? 0) + 1;
        const payload = {
          type: "SetInstructions",
          instructions: args.body ? { body: args.body, version } : undefined,
        } as ActionPayload;
        return write(envelope, scapeId, target, [payload], "Updated the scape's instructions.");
      }
      case "arrange_scape":
        return write(
          envelope,
          scapeId,
          target,
          [],
          `Arranged the scape (${args.mode}).`,
          args.mode,
        );
      case "focus_objects": {
        if (!target.live)
          return failure(
            "not_open",
            "This scape is not open in Precipice, so there is no canvas to focus.",
          );
        const ids = args.ids.filter((id: string) => scape.objects[id]);
        target.live.focus(ids);
        return ok({ focused: ids });
      }
      case "duplicate_scape": {
        if (grant.scapes !== "all")
          return failure(
            "forbidden",
            "This connection is limited to specific scapes, so it cannot create new ones.",
          );
        const copy = await deps.library.duplicate(scapeId);
        return ok({ scape_id: copy.id, name: copy.name });
      }
      case "publish_scape":
        return write(
          envelope,
          scapeId,
          target,
          [],
          `Publish “${scape.name}” as a public, read-only snapshot. Anyone with the link can view it.`,
        );
      case "unpublish_scape":
        return write(
          envelope,
          scapeId,
          target,
          [],
          `Withdraw the public snapshot of “${scape.name}”.`,
        );
      case "delete_scape":
        return write(envelope, scapeId, target, [], `Delete the scape “${scape.name}”.`);
      case "revert_operation": {
        const operation = await deps.operations.get(args.operation_id);
        if (!operation || operation.scapeId !== scapeId || !operation.inverses?.length)
          return failure("not_found", "No revertible operation with that ID on this scape.");
        if (operation.afterRevision !== (await revision(scape)))
          return failure(
            "revision_conflict",
            "The scape changed after that operation, so reverting it could undo someone else's work.",
          );
        const payloads = operation.inverses.map(
          ({ txId: _t, ts: _ts, ...rest }) => rest as ActionPayload,
        );
        return write(envelope, scapeId, target, payloads, `Reverted ${operation.key}.`);
      }
    }
    return failure("unknown_tool");
  }

  // Both transports and review buttons share one queue, so concurrent snapshots cannot
  // overwrite one another and simultaneous retries cannot execute the same key twice.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };
  return {
    execute: (envelope: Envelope) => serial(() => execute(envelope)),
    resolveReview: (key: string, approve: boolean) => serial(() => resolveReview(key, approve)),
  };
}

export type CommandService = ReturnType<typeof createCommandService>;

export function summarizeChanges(actions: ActionPayload[]): string {
  const counts = new Map<string, number>();
  for (const action of actions) counts.set(action.type, (counts.get(action.type) ?? 0) + 1);
  const words: Record<string, [string, string]> = {
    CreateObject: ["added", "object"],
    UpdateObject: ["updated", "object"],
    DeleteObject: ["deleted", "object"],
    ConnectObjects: ["added", "connection"],
    DisconnectObjects: ["removed", "connection"],
    RenameScape: ["renamed", "scape"],
    SetInstructions: ["updated", "instruction set"],
  };
  const parts = [...counts].map(([type, n]) => {
    const [verb, noun] = words[type] ?? ["applied", type];
    return type === "RenameScape"
      ? "renamed the scape"
      : `${verb} ${n} ${noun}${n === 1 ? "" : "s"}`;
  });
  const text = parts.join(", ") || "no changes";
  return text[0].toUpperCase() + text.slice(1) + ".";
}
