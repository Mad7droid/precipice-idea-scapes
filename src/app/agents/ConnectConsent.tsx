import { useEffect, useState } from "react";
import type { ScapeSummary } from "@/core/types";
import { notify } from "@/core/notify";
import { Button } from "@/design/Button";
import { scapeRepository } from "@/persistence/scapeRepository";
import { TurnstileChallenge } from "@/publish/PublishSheet";
import { readSession, startSignIn } from "@/publish/session";
import { connectApi, ConnectError, type ConnectRequest } from "@/mcp/host/connectApi";
import { refreshAgentRelay } from "@/mcp/host/runtime";
import { Brand } from "../Brand";
import { navigate } from "../router";

/**
 * The one screen between "add Precipice to my agent" and using it.
 *
 * An agent's OAuth request lands here, in the app, because only the app knows the person's
 * scapes. The defaults are the seamless ones — every scape, can edit, apply straight away (each
 * batch is still one undo) — so most people read it and press Allow.
 */
export function ConnectConsent({ requestId }: { requestId: string }) {
  const [signedIn] = useState(() => readSession() !== null);
  const [request, setRequest] = useState<ConnectRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scapes, setScapes] = useState<ScapeSummary[]>([]);
  const [host, setHost] = useState<"web" | "desktop">("web");
  const [scope, setScope] = useState<"all" | "some">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [write, setWrite] = useState(true);
  const [mode, setMode] = useState<"direct" | "review">("review");
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    void connectApi
      .request(requestId)
      .then(setRequest)
      .catch((cause: unknown) =>
        setError(
          cause instanceof ConnectError ? cause.message : "This request could not be loaded.",
        ),
      );
    void scapeRepository.list().then(setScapes);
  }, [requestId, signedIn]);

  const finish = async (approve: boolean) => {
    setBusy(true);
    try {
      const { redirectTo } = approve
        ? await connectApi.approve(requestId, {
            host,
            scapes: host === "desktop" || scope === "all" ? "all" : [...picked],
            mode,
            write,
          })
        : await connectApi.deny(requestId);
      if (approve) refreshAgentRelay();
      window.location.assign(redirectTo);
    } catch (cause) {
      notify.error(cause instanceof ConnectError ? cause.message : "Could not finish connecting.");
      setBusy(false);
    }
  };

  return (
    <main className="grid h-full place-items-center overflow-y-auto bg-base p-4">
      <div className="w-full max-w-[440px] rounded-xl border border-subtle bg-surface p-6 shadow-lg">
        <Brand compact />
        {!signedIn ? (
          <>
            <h1 className="mt-5 text-lg text-fg">Sign in to connect your agent</h1>
            <p className="mt-2 text-xs text-fg-secondary">
              Agents reach your scapes through your Precipice account. Your scapes stay on this
              device; the agent can only reach them while Precipice is open.
            </p>
            <div className="mt-4">
              {!signingIn ? (
                <Button variant="primary" size="sm" onClick={() => setSigningIn(true)}>
                  Continue with Google
                </Button>
              ) : (
                <TurnstileChallenge
                  disabled={busy}
                  onToken={(token) => {
                    setBusy(true);
                    void startSignIn(`/connect/${requestId}`, token).catch(() => {
                      notify.error("Could not start sign-in.");
                      setBusy(false);
                    });
                  }}
                />
              )}
            </div>
          </>
        ) : error ? (
          <>
            <h1 className="mt-5 text-lg text-fg">This link has expired</h1>
            <p className="mt-2 text-xs text-fg-secondary">{error}</p>
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={() => navigate("/")}>
                Go to Precipice
              </Button>
            </div>
          </>
        ) : !request ? (
          <p className="mt-5 text-xs text-fg-secondary" role="status">
            Loading…
          </p>
        ) : (
          <>
            <h1 className="mt-5 text-lg text-fg">
              Connect <span className="text-fg">{request.clientName}</span> to Precipice?
            </h1>
            <p className="mt-1 text-xs text-fg-tertiary">
              Signed in as {request.email} · returns to{" "}
              <span className="mono">{request.redirectHost}</span>
            </p>

            <fieldset className="mt-5">
              <legend className="mb-1.5 text-xs text-fg-secondary">Library</legend>
              <Choice checked={host === "web"} onChange={() => setHost("web")} name="host">
                This browser
              </Choice>
              <Choice
                checked={host === "desktop"}
                onChange={() => {
                  setHost("desktop");
                  setScope("all");
                }}
                name="host"
              >
                Desktop app (connect this Mac in its Agents settings first)
              </Choice>
            </fieldset>
            {host === "web" && (
              <fieldset className="mt-5">
                <legend className="mb-1.5 text-xs text-fg-secondary">Scapes it can use</legend>
                <Choice checked={scope === "all"} onChange={() => setScope("all")} name="scope">
                  All my scapes, including new ones
                </Choice>
                <Choice checked={scope === "some"} onChange={() => setScope("some")} name="scope">
                  Only the ones I choose
                </Choice>
                {scope === "some" && (
                  <div className="ml-6 mt-1.5 max-h-40 overflow-y-auto rounded-md border border-subtle bg-inset p-2">
                    {scapes.length === 0 && (
                      <p className="text-2xs text-fg-tertiary">No scapes in this browser yet.</p>
                    )}
                    {scapes.map((scape) => (
                      <label
                        key={scape.id}
                        className="flex items-center gap-2 py-0.5 text-xs text-fg"
                      >
                        <input
                          type="checkbox"
                          checked={picked.has(scape.id)}
                          onChange={(event) =>
                            setPicked((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(scape.id);
                              else next.delete(scape.id);
                              return next;
                            })
                          }
                        />
                        <span className="truncate">{scape.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}

            <fieldset className="mt-4">
              <legend className="mb-1.5 text-xs text-fg-secondary">What it can do</legend>
              <Choice checked={write} onChange={() => setWrite(true)} name="write">
                Read and edit
              </Choice>
              <Choice checked={!write} onChange={() => setWrite(false)} name="write">
                Read only
              </Choice>
            </fieldset>

            {write && (
              <fieldset className="mt-4">
                <legend className="mb-1.5 text-xs text-fg-secondary">When it edits</legend>
                <Choice checked={mode === "direct"} onChange={() => setMode("direct")} name="mode">
                  Apply right away — each change is one undo
                </Choice>
                <Choice checked={mode === "review"} onChange={() => setMode("review")} name="mode">
                  Ask me before applying
                </Choice>
              </fieldset>
            )}

            <p className="mt-4 text-2xs text-fg-tertiary">
              You can remove this any time in Settings → Agents. Deleting a scape always asks you
              first.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void finish(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || (scope === "some" && picked.size === 0)}
                onClick={() => void finish(true)}
              >
                {busy ? "Connecting…" : "Allow"}
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Choice({
  checked,
  onChange,
  name,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-fg">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      {children}
    </label>
  );
}
