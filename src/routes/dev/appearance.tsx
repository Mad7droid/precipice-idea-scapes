import { useEffect, useState } from "react";
import { Brand } from "@/app/Brand";
import { ThemeControl } from "@/app/ThemeControl";
import { useTheme } from "@/app/theme";
import { useInterfaceStyle } from "@/app/useInterfaceStyle";
import { Scapi } from "@/components/scapi/Scapi";
import { Button } from "@/design/Button";
import { Select } from "@/design/Select";
import { INTERFACE_STYLES } from "@/design/interfaceStyle";
import type { InterfaceStyle } from "@/core/types";
import { openWorkspaceTool } from "@/app/workspaceEvents";

/** Actual shared components/tokens on an isolated dev route, not another mockup system. */
export function DevAppearance() {
  const [style, setStyle] = useInterfaceStyle();
  const [theme, setTheme, resolved] = useTheme();
  const [tokens, setTokens] = useState<Record<string, string>>({});
  useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    setTokens(
      Object.fromEntries(
        ["--bg-base", "--bg-surface", "--accent", "--action-primary", "--text-primary"].map(
          (key) => [key, computed.getPropertyValue(key).trim()],
        ),
      ),
    );
  }, [style, resolved]);
  return (
    <main className="h-full overflow-auto bg-base p-6 text-fg sm:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <Brand />
          <a href="#/" className="text-sm text-fg-secondary underline">
            Open workspace
          </a>
        </div>
        <h1 className="mt-10 font-pixel text-2xl">Interface styles</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          Shared components, original artwork and fictional content.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-5">
          <Select
            label="Interface style"
            value={style}
            onChange={(next) => void setStyle(next as InterfaceStyle)}
            options={[...INTERFACE_STYLES]}
          />
          <ThemeControl value={theme} onChange={setTheme} />
        </div>
        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-default bg-surface p-6">
            <h2 className="font-pixel text-xl">Research workspace</h2>
            <p className="mt-2 text-sm text-fg-secondary">
              Collect observations, connect findings and record decisions.
            </p>
            <p className="mt-3 text-xs text-fg-tertiary">8 notes · 3 connections · Active</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="primary">Continue working</Button>
              <Button onClick={() => openWorkspaceTool("capture")}>Capture a note</Button>
              <Button variant="ghost" onClick={() => openWorkspaceTool("search")}>
                Search content
              </Button>
            </div>
            <label className="mt-6 block text-xs text-fg-secondary" htmlFor="appearance-note">
              Note title
            </label>
            <input
              id="appearance-note"
              defaultValue="Interview synthesis"
              className="mt-2 w-full rounded-md border border-default bg-inset px-3 py-2 text-fg placeholder:text-fg-tertiary focus:border-focus focus-self"
            />
          </div>
          <div className="rounded-xl border border-default bg-canvas p-6">
            <div className="flex items-start gap-4">
              <Scapi size={64} animated={false} effects={false} />
              <div>
                <h2 className="text-lg">Scapi</h2>
                <p className="mt-1 text-sm text-fg-secondary">
                  Original orange artwork in every style.
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-lg border border-focus bg-raised p-5">
              <span className="text-xs text-fg-accent">Selected note</span>
              <h3 className="mt-2 text-base font-medium">Keep the next step visible</h3>
              <p className="mt-2 text-sm text-fg-secondary">
                A note can become a plan without losing the source material.
              </p>
            </div>
            <div className="workspace-selected mt-4 rounded-md bg-selected p-3 text-sm">
              Selected navigation
            </div>
          </div>
        </section>
        <section className="mt-8 rounded-lg border border-subtle p-4">
          <h2 className="text-sm font-medium">Applied values</h2>
          <p className="mt-2 text-xs text-fg-secondary">
            {style} / {resolved} / root:{" "}
            {document.documentElement.dataset.interfaceStyle ?? "current"}
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(tokens).map(([name, value]) => (
              <div key={name} className="flex justify-between gap-4 text-xs">
                <dt>{name}</dt>
                <dd className="font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
