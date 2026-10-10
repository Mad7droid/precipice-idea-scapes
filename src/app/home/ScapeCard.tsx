import { useRef, useState } from "react";
import type { PublicationRecord, ScapeSummary } from "@/core/types";
import { getPlugin } from "@/core/registry";
import { getStarter } from "@/starters";
import { buttonClass } from "@/design/Button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/design/Menu";
import { ScapeThumbnail } from "../ScapeThumbnail";
import { describeContents, relativeTime } from "./library";
import { MoreIcon, PinIcon } from "./icons";
import { StarterMark } from "./StarterMark";

export type CardAction =
  | "open"
  | "pin"
  | "rename"
  | "duplicate"
  | "scape"
  | "pdf"
  | "publish"
  | "delete"
  | "public"
  | "copy";

const ICON_BUTTON = buttonClass({ variant: "ghost", shape: "icon", size: "sm" });

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
  const starter = getStarter(scape.starter);
  const contents = describeContents(scape, (type) => getPlugin(type)?.label ?? type);
  const published = publication?.status === "published";
  const edited = new Date(scape.updatedAt);

  const status = publication && (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-fg-secondary"
      title={
        published
          ? "A read-only snapshot is live at a public link"
          : "Unpublished. The public address is reserved but shows nothing"
      }
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${published ? "bg-success" : "bg-[var(--border-strong)]"}`}
      />
      {published ? "Published" : "Unpublished"}
    </span>
  );

  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        disabled={busy}
        aria-label={`${pinned ? "Unpin" : "Pin"} ${scape.name}`}
        aria-pressed={pinned}
        title={pinned ? "Unpin" : "Pin to the top of your library"}
        onClick={() => onAction("pin")}
        className={`${ICON_BUTTON} ${
          pinned
            ? "!text-fg-accent"
            : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        <PinIcon filled={pinned} />
      </button>
      <div ref={boundary} className="relative">
        <button
          ref={trigger}
          type="button"
          disabled={busy}
          aria-label={`Actions for ${scape.name}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          title="More actions"
          onClick={() => setMenu(!menu)}
          className={`${ICON_BUTTON} ${menu ? "bg-hover text-fg" : ""}`}
        >
          <MoreIcon />
        </button>
        {menu && (
          <div
            className={`absolute right-0 z-popover ${list ? "top-full mt-1" : "bottom-full mb-1"}`}
          >
            <Menu
              open={menu}
              label={`Scape actions: ${scape.name}`}
              boundaryRef={boundary}
              onClose={close}
            >
              <MenuItem onSelect={() => choose("open")}>Open</MenuItem>
              <MenuItem onSelect={() => choose("rename")}>Rename…</MenuItem>
              <MenuItem onSelect={() => choose("duplicate")}>Duplicate</MenuItem>
              <MenuItem onSelect={() => choose("pin")}>{pinned ? "Unpin" : "Pin to top"}</MenuItem>
              <MenuSeparator />
              <MenuLabel>Download</MenuLabel>
              <MenuItem onSelect={() => choose("scape")} caption="For backup or another device">
                Scape file (.scape)
              </MenuItem>
              <MenuItem onSelect={() => choose("pdf")}>PDF</MenuItem>
              <MenuSeparator />
              <MenuItem
                onSelect={() => choose("publish")}
                caption={publication ? "Update or unpublish the link" : "Share a read-only link"}
              >
                {publication ? "Manage publication…" : "Publish…"}
              </MenuItem>
              {published && (
                <>
                  <MenuItem onSelect={() => choose("public")}>Open public link</MenuItem>
                  <MenuItem onSelect={() => choose("copy")}>Copy public link</MenuItem>
                </>
              )}
              <MenuSeparator />
              <MenuItem onSelect={() => choose("delete")}>
                <span className="text-danger">Delete…</span>
              </MenuItem>
            </Menu>
          </div>
        )}
      </div>
    </div>
  );

  const time = busy ? (
    <span role="status" className="text-xs text-fg-secondary">
      Working…
    </span>
  ) : (
    <time
      dateTime={edited.toISOString()}
      title={`Last edited ${edited.toLocaleString()}`}
      className="shrink-0 text-xs text-fg-tertiary"
    >
      Edited {relativeTime(scape.updatedAt)}
    </time>
  );

  if (list)
    return (
      <li
        aria-busy={busy}
        className="group relative flex items-center gap-4 px-3 py-2.5 transition-colors duration-instant ease-out hover:bg-hover"
      >
        <button
          type="button"
          onClick={() => onAction("open")}
          aria-label={`Open ${scape.name}`}
          tabIndex={-1}
          className="hidden shrink-0 sm:block"
        >
          <ScapeThumbnail preview={scape.preview} />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onAction("open")}
            className="block max-w-full truncate text-left text-sm font-medium text-fg"
            title={scape.name}
          >
            {scape.name}
          </button>
          <p className="truncate text-xs text-fg-tertiary" title={contents}>
            {starter.id === "blank" ? contents : `${starter.label} · ${contents}`}
          </p>
        </div>
        <div className="hidden w-28 shrink-0 md:block">{status}</div>
        <div className="hidden w-28 shrink-0 text-right sm:block">{time}</div>
        {actions}
      </li>
    );

  return (
    <li
      aria-busy={busy}
      className="group relative flex flex-col rounded-xl border border-subtle bg-surface transition-[border-color,box-shadow] duration-fast ease-out hover:border-default hover:shadow-md focus-within:border-default"
    >
      <button
        type="button"
        onClick={() => onAction("open")}
        aria-label={`Open ${scape.name}`}
        tabIndex={-1}
        className="block w-full overflow-hidden rounded-t-xl bg-inset text-left"
      >
        {scape.preview?.nodes.length ? (
          <ScapeThumbnail preview={scape.preview} large />
        ) : (
          // An empty scape has nothing to draw, so it shows what it was made to become.
          <span className="flex h-40 flex-col items-center justify-center gap-2 text-xs text-fg-tertiary">
            <StarterMark starter={starter} active={false} />
            Empty {starter.id === "blank" ? "canvas" : starter.label.toLowerCase()}
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col px-4 pb-3 pt-3">
        <button
          type="button"
          onClick={() => onAction("open")}
          className="block w-full truncate text-left text-base font-medium text-fg"
          title={scape.name}
        >
          {scape.name}
        </button>
        <p className="mt-0.5 truncate text-xs text-fg-tertiary" title={contents}>
          {starter.id === "blank" ? contents : `${starter.label} · ${contents}`}
        </p>
        <div className="mt-3 flex min-h-8 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            {time}
            {status}
          </div>
          {actions}
        </div>
      </div>
    </li>
  );
}
