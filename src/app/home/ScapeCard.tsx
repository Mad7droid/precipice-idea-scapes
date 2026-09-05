import { useRef, useState } from "react";
import type { PublicationRecord, ScapeSummary } from "@/core/types";
import { getPlugin } from "@/core/registry";
import { getStarter } from "@/starters";
import { Menu, MenuItem } from "@/design/Menu";
import { ScapeThumbnail } from "../ScapeThumbnail";
import { relativeTime } from "../ScapeList";
import { HOME_BUTTON } from "./CreationPanel";

export type CardAction =
  | "open"
  | "pin"
  | "rename"
  | "duplicate"
  | "scape"
  | "pdf"
  | "publish"
  | "scapi"
  | "agent"
  | "delete"
  | "public"
  | "copy";
export function ScapeCard({
  scape,
  pinned,
  publication,
  list,
  busy,
  onAction,
}: {
  scape: ScapeSummary;
  pinned: boolean;
  publication?: PublicationRecord;
  list: boolean;
  busy: boolean;
  onAction: (action: CardAction) => void;
}) {
  const [menu, setMenu] = useState(false);
  const boundary = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setMenu(false);
    trigger.current?.focus();
  };
  const choose = (action: CardAction) => {
    close();
    onAction(action);
  };
  return (
    <li
      aria-busy={busy}
      className={`relative rounded-xl border border-subtle bg-surface ${list ? "flex items-center gap-4 p-3" : ""}`}
    >
      <button
        onClick={() => onAction("open")}
        aria-label={`Open ${scape.name}`}
        className={
          list ? "hidden shrink-0 sm:block" : "block w-full rounded-t-xl bg-inset text-left"
        }
      >
        <ScapeThumbnail preview={scape.preview} large={!list} />
      </button>
      <div className={list ? "min-w-0 flex-1" : "px-4 pb-4 pt-3"}>
        <div className="mb-2 flex min-h-6 flex-wrap items-center gap-2 text-xs text-fg-tertiary">
          <span>{getStarter(scape.starter).label}</span>
          {publication && (
            <span
              className="rounded-full border border-subtle px-2 py-0.5"
              title="Last known publication status in this browser"
            >
              {publication.status === "published" ? "Published" : "Unpublished"}
            </span>
          )}
        </div>
        <button
          onClick={() => onAction("open")}
          className="block w-full truncate text-left text-base font-medium text-fg"
          title={scape.name}
        >
          {scape.name}
        </button>
        <p
          className="mt-2 truncate text-xs text-fg-tertiary"
          title={Object.entries(scape.typeCounts)
            .map(([type, count]) => `${count} ${getPlugin(type)?.label ?? type}`)
            .join(" · ")}
        >
          {scape.objectCount === 0
            ? "Empty canvas · ready for your ideas"
            : Object.entries(scape.typeCounts)
                .map(
                  ([type, count]) =>
                    `${count} ${getPlugin(type)?.label ?? type}${count === 1 ? "" : "s"}`,
                )
                .join(" · ")}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <time
            dateTime={new Date(scape.updatedAt).toISOString()}
            title={new Date(scape.updatedAt).toLocaleString()}
            className="text-xs text-fg-tertiary"
          >
            Edited {relativeTime(scape.updatedAt)}
          </time>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={busy}
              aria-label={`${pinned ? "Unpin" : "Pin"} ${scape.name}`}
              aria-pressed={pinned}
              onClick={() => onAction("pin")}
              className={`${HOME_BUTTON} !p-2`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill={pinned ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.2"
                aria-hidden
              >
                <path d="m6 2 6 2-2 4 1 3-4-1-3 4 1-5-2-2 3-1Z" />
              </svg>
            </button>
            <div ref={boundary} className="relative">
              <button
                ref={trigger}
                disabled={busy}
                aria-label={`Actions for ${scape.name}`}
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
                className={`${HOME_BUTTON} !p-2`}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <circle cx="3" cy="8" r="1.2" />
                  <circle cx="8" cy="8" r="1.2" />
                  <circle cx="13" cy="8" r="1.2" />
                </svg>
              </button>
              {menu && (
                <div className="absolute bottom-full right-0 z-popover mb-1 max-h-[60vh] overflow-y-auto">
                  <Menu
                    open={menu}
                    label={`Scape actions: ${scape.name}`}
                    boundaryRef={boundary}
                    onClose={close}
                  >
                    <MenuItem onSelect={() => choose("open")}>Open</MenuItem>
                    <MenuItem onSelect={() => choose("pin")}>{pinned ? "Unpin" : "Pin"}</MenuItem>
                    <MenuItem onSelect={() => choose("rename")}>Rename</MenuItem>
                    <MenuItem onSelect={() => choose("duplicate")}>Duplicate</MenuItem>
                    <MenuItem onSelect={() => choose("scape")}>Export scape</MenuItem>
                    <MenuItem onSelect={() => choose("pdf")}>Export PDF</MenuItem>
                    <MenuItem onSelect={() => choose("publish")}>
                      {publication ? "Manage publication" : "Publish"}
                    </MenuItem>
                    {publication?.status === "published" && (
                      <>
                        <MenuItem onSelect={() => choose("public")}>Open public link</MenuItem>
                        <MenuItem onSelect={() => choose("copy")}>Copy public link</MenuItem>
                      </>
                    )}
                    <MenuItem onSelect={() => choose("scapi")}>Ask Scapi</MenuItem>
                    <MenuItem onSelect={() => choose("agent")}>Connect an agent</MenuItem>
                    <MenuItem onSelect={() => choose("delete")}>
                      <span className="text-danger">Delete</span>
                    </MenuItem>
                  </Menu>
                </div>
              )}
            </div>
          </div>
        </div>
        {busy && (
          <p role="status" className="mt-2 text-xs text-fg-secondary">
            Working…
          </p>
        )}
      </div>
    </li>
  );
}
