import type { ReactNode } from "react";
import type { ThemePreference } from "@/core/types";
import { Brand } from "../Brand";
import { navigate } from "../router";
import { ThemeControl } from "../ThemeControl";
import { PAGE_ROUTE, type HomePage } from "./routes";
import {
  AgentIcon,
  BackupIcon,
  GlobeIcon,
  HelpIcon,
  HomeIcon,
  ImportIcon,
  InstructionsIcon,
  PlusIcon,
  SettingsIcon,
  TemplatesIcon,
} from "./icons";

const PAGES: { id: HomePage; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <HomeIcon /> },
  { id: "templates", label: "Templates", icon: <TemplatesIcon /> },
  { id: "published", label: "Published", icon: <GlobeIcon /> },
  { id: "agents", label: "Agents", icon: <AgentIcon /> },
  { id: "instructions", label: "Instructions", icon: <InstructionsIcon /> },
];

export type SidebarProps = {
  page: HomePage;
  publishedCount: number;
  hasInstructions: boolean;
  onNewScape: () => void;
  onImport: () => void;
  importDisabled: boolean;
  onBackUp: () => void;
  backUpDisabled: boolean;
  onSettings: () => void;
  onHelp: () => void;
  theme: ThemePreference;
  onTheme: (next: ThemePreference) => void;
  storage: string;
};

const ROW =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-instant ease-out disabled:opacity-50";

/**
 * The home shell's navigation. Everything that is not a single scape lives here, so the home
 * page itself can be only two things: start something, and find something.
 */
export function Sidebar(props: SidebarProps) {
  return (
    <nav
      aria-label="Workspace"
      className="hidden w-60 shrink-0 flex-col border-r border-subtle bg-surface md:flex"
    >
      <div className="px-4 pb-3 pt-4">
        <Brand />
      </div>
      <div className="px-3">
        <button
          type="button"
          onClick={props.onNewScape}
          className={`${ROW} border border-default bg-raised text-fg shadow-sm hover:bg-hover`}
        >
          <PlusIcon />
          New scape
        </button>
      </div>
      <ul className="mt-4 space-y-0.5 px-3">
        {PAGES.map((item) => (
          <li key={item.id}>
            <PageLink {...props} item={item} />
          </li>
        ))}
      </ul>
      <div className="mt-auto space-y-0.5 border-t border-subtle px-3 py-3">
        <button
          type="button"
          onClick={props.onImport}
          disabled={props.importDisabled}
          title="Open a .scape file or a library backup. Imports are added as new copies."
          className={`${ROW} text-fg-secondary hover:bg-hover hover:text-fg`}
        >
          <ImportIcon />
          Import
        </button>
        <button
          type="button"
          onClick={props.onBackUp}
          disabled={props.backUpDisabled}
          title="Download every scape as one file you can import anywhere."
          className={`${ROW} text-fg-secondary hover:bg-hover hover:text-fg`}
        >
          <BackupIcon />
          Back up library
        </button>
        <button
          type="button"
          onClick={props.onSettings}
          className={`${ROW} text-fg-secondary hover:bg-hover hover:text-fg`}
        >
          <SettingsIcon />
          Settings
        </button>
        <button
          type="button"
          onClick={props.onHelp}
          className={`${ROW} text-fg-secondary hover:bg-hover hover:text-fg`}
        >
          <HelpIcon />
          Help
        </button>
        <div className="flex items-center justify-between gap-2 px-2.5 pt-3">
          <ThemeControl value={props.theme} onChange={props.onTheme} compact />
        </div>
        <p className="px-2.5 pt-2 text-2xs text-fg-tertiary">{props.storage}</p>
      </div>
    </nav>
  );
}

function PageLink({
  item,
  page,
  publishedCount,
  hasInstructions,
}: SidebarProps & { item: (typeof PAGES)[number] }) {
  const active = page === item.id;
  return (
    <a
      href={`#${PAGE_ROUTE[item.id]}`}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        navigate(PAGE_ROUTE[item.id]);
      }}
      className={
        ROW +
        " " +
        (active ? "bg-selected text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg")
      }
    >
      {item.icon}
      <span className="flex-1">{item.label}</span>
      {item.id === "published" && publishedCount > 0 && (
        <span className="text-xs text-fg-tertiary">{publishedCount}</span>
      )}
      {item.id === "instructions" && hasInstructions && (
        <span className="text-2xs text-fg-tertiary">On</span>
      )}
    </a>
  );
}

/** Below the sidebar breakpoint the same pages become one scrolling row under the brand. */
export function MobileNav({
  page,
  onNewScape,
  onImport,
  onSettings,
  onHelp,
}: {
  page: HomePage;
  onNewScape: () => void;
  onImport: () => void;
  onSettings: () => void;
  onHelp: () => void;
}) {
  const icon =
    "grid h-8 w-8 place-items-center rounded-md text-fg-secondary hover:bg-hover hover:text-fg";
  return (
    <div className="border-b border-subtle bg-surface md:hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <Brand />
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Import" onClick={onImport} className={icon}>
            <ImportIcon />
          </button>
          <button type="button" aria-label="Open settings" onClick={onSettings} className={icon}>
            <SettingsIcon />
          </button>
          <button type="button" aria-label="Open help" onClick={onHelp} className={icon}>
            <HelpIcon />
          </button>
          <button
            type="button"
            onClick={onNewScape}
            className={`${ROW} w-auto border border-default bg-raised text-fg`}
          >
            <PlusIcon />
            New
          </button>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto px-3 pb-2">
        {PAGES.map((item) => (
          <a
            key={item.id}
            href={`#${PAGE_ROUTE[item.id]}`}
            aria-current={page === item.id ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate(PAGE_ROUTE[item.id]);
            }}
            className={
              "shrink-0 rounded-full px-3 py-1 text-sm " +
              (page === item.id ? "bg-selected text-fg" : "text-fg-secondary")
            }
          >
            {item.label}
          </a>
        ))}
      </div>
    </div>
  );
}
