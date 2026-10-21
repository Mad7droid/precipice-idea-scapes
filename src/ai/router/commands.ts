import type { LocalCommand, RouteContext } from "./types";
import { VIEW_COMMANDS } from "./types";

/**
 * What a command chip says it will do, before Enter.
 *
 * v1 runs nothing on its own, view commands included (docs/voice-and-routing-plan.md). The
 * label is the promise: it names the target object rather than echoing the draft, so a
 * mis-heard "zoom to roadmap" shows which roadmap before anything moves.
 */
export function describeCommand(command: LocalCommand, objects: RouteContext["objects"]): string {
  switch (command.kind) {
    case "undo":
      return "Undo the last change";
    case "redo":
      return "Redo";
    case "select-all":
      return "Select everything";
    case "fit":
      return "Fit the canvas in view";
    case "connect":
      return "Connect the selection";
    case "focus": {
      const target = objects.find((object) => object.id === command.target);
      return target ? `Zoom to “${target.title || target.type}”` : "Zoom to object";
    }
  }
}

/** Whether running the command changes the saved scape, rather than only the view. */
export function changesScape(command: LocalCommand): boolean {
  return !VIEW_COMMANDS.has(command.kind);
}
