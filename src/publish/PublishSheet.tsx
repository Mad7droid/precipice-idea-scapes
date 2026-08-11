import { useEffect, useRef, useState } from "react";
import { notify } from "@/core/notify";
import type { Scape } from "@/core/types";
import { type Publication, type PublicationList } from "./contract";
import {
  PublishClientError,
  createInvite,
  createPublication,
  listAdmin,
  listPublications,
  republish,
  revokeInvite,
  setMemberStatus,
  unpublish,
  updatePublication,
  type RequestOptions,
} from "./client";
import { projectScape } from "./project";
import { describeState, type PublicationView } from "./usePublication";

/**
 * Publishing, in one sheet.
 *
 * The thing this has to make unambiguous is the local/public distinction: a scape on your disk
 * and a snapshot on a server are two different objects, and every confusing bug report about a
 * publishing feature comes from a UI that let someone forget that. So the sheet always says
 * which of the two an action affects, and unpublishing says plainly that the local scape is
 * untouched.
 */
export function PublishSheet({
  scape,
  publication,
  options,
  onClose,
  onSignIn,
  isAdmin = false,
}: {
  scape: Scape;
  publication: PublicationView;
  options: RequestOptions;
  onClose: () => void;
  onSignIn: (turnstileToken: string) => Promise<void> | void;
  isAdmin?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [quota, setQuota] = useState<PublicationList | null>(null);
  const { state, skipped, signedIn } = publication;

  useEffect(() => {
    if (!signedIn) return;
    void listPublications(options)
      .then(setQuota)
      .catch(() => setQuota(null));
  }, [signedIn, options, state.kind]);

  const run = async (label: string, action: () => Promise<Publication>) => {
    setBusy(label);
    try {
      await publication.record(await action());
      notify.success(`${label}.`);
      void listPublications(options).then(setQuota).catch(() => {});
    } catch (error) {
      const message =
        error instanceof PublishClientError ? error.message : "Something went wrong.";
      notify.error(message);
      // A fresh Turnstile token is required before OAuth can begin, so an expired session is
      // surfaced here instead of silently launching a redirect the user cannot complete.
    } finally {
      setBusy(null);
    }
  };

  const projection = projectScape(scape).scape;

  return (
    <div
      className="fixed inset-0 z-modal grid place-items-center bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-[440px] rounded-xl border border-subtle bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Publish"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg text-fg">Publish</h2>
          <span className="mono text-fg-tertiary">{describeState(state)}</span>
        </div>

        <p className="mt-2 text-xs text-fg-secondary">
          Publishing puts a read-only copy of this scape at a public address. Your local scape
          stays private and keeps working exactly as it does now.
        </p>

        {!signedIn ? (
          <SignedOut onSignIn={onSignIn} />
        ) : (
          <>
            {state.kind !== "unpublished" && <PublicUrl url={state.url} />}

            <div className="mt-4 flex flex-wrap gap-2">
              {state.kind === "unpublished" && (
                <Primary
                  busy={busy === "Published"}
                  disabled={busy !== null || projection.objects.length === 0}
                  onClick={() =>
                    run("Published", () => createPublication(projection, options))
                  }
                >
                  Publish
                </Primary>
              )}

              {(state.kind === "published" || state.kind === "stale") && (
                <>
                  <Primary
                    busy={busy === "Updated"}
                    disabled={busy !== null || state.kind === "published"}
                    onClick={() =>
                      run("Updated", () =>
                        updatePublication(state.record.publicationId, projection, options),
                      )
                    }
                  >
                    {state.kind === "stale" ? "Update public copy" : "Up to date"}
                  </Primary>
                  <Secondary
                    disabled={busy !== null}
                    onClick={() =>
                      run("Unpublished", () => unpublish(state.record.publicationId, options))
                    }
                  >
                    Unpublish
                  </Secondary>
                </>
              )}

              {state.kind === "withdrawn" && (
                <Primary
                  busy={busy === "Published"}
                  disabled={busy !== null}
                  onClick={() =>
                    run("Published", () => republish(state.record.publicationId, options))
                  }
                >
                  Publish again
                </Primary>
              )}
            </div>

            {state.kind === "withdrawn" && (
              <p className="mt-2 text-2xs text-fg-tertiary">
                The address is reserved. Publishing again restores the same link.
              </p>
            )}

            {quota && <Quota list={quota} />}
            {isAdmin && <AdminPanel options={options} />}
          </>
        )}

        {skipped.length > 0 && (
          <p className="mt-4 rounded-md bg-inset px-2.5 py-2 text-2xs text-fg-tertiary">
            {skipped.length} {skipped.length === 1 ? "block" : "blocks"} will not be included:{" "}
            {skipped.map((item) => `${item.id} (${item.reason})`).join(", ")}
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <Secondary disabled={busy !== null} onClick={onClose}>
            Close
          </Secondary>
        </div>
      </div>
    </div>
  );
}

function AdminPanel({ options }: { options: RequestOptions }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof listAdmin>> | null>(null);
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setData(await listAdmin(options)); }
    catch (error) { notify.error(error instanceof PublishClientError ? error.message : "Could not load administration."); }
  };
  const loadMore = async () => {
    if (!data?.nextCursor) return;
    try {
      const next = await listAdmin(options, data.nextCursor);
      setData({ invites: [...data.invites, ...next.invites], members: [...data.members, ...next.members], nextCursor: next.nextCursor });
    } catch (error) { notify.error(error instanceof PublishClientError ? error.message : "Could not load more members."); }
  };
  const mutate = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); await refresh(); }
    catch (error) { notify.error(error instanceof PublishClientError ? error.message : "Could not update administration."); }
    finally { setBusy(false); }
  };
  if (!open) return <button type="button" className="mt-4 text-2xs text-fg-secondary underline-offset-2 hover:text-fg hover:underline" onClick={() => { setOpen(true); void refresh(); }}>Publishing administration</button>;
  return (
    <section className="mt-4 rounded-md border border-subtle bg-inset p-3" aria-label="Publishing administration">
      <div className="flex items-center justify-between"><h3 className="text-xs text-fg">Publishing administration</h3><button type="button" className="text-2xs text-fg-secondary hover:text-fg" onClick={() => setOpen(false)}>Hide</button></div>
      <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!invite.trim()) return; void mutate(async () => { await createInvite(invite, options); setInvite(""); }); }}>
        <input value={invite} onChange={(event) => setInvite(event.target.value)} type="email" required placeholder="invitee@example.com" className="min-w-0 flex-1 rounded-sm border border-subtle bg-surface px-2 py-1 text-2xs text-fg" />
        <button type="submit" disabled={busy} className="rounded-md border border-default px-3 py-1.5 text-xs text-fg-secondary transition-colors duration-fast hover:bg-active disabled:opacity-50">Invite</button>
      </form>
      <div className="mt-3 space-y-2 text-2xs">
        <p className="text-fg-tertiary">Pending invitations</p>
        {(data?.invites.filter((item) => item.status === "pending") ?? []).map((item) => <div key={item.email} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-fg-secondary">{item.email}</span><button type="button" disabled={busy} className="text-fg-secondary hover:text-fg" onClick={() => void mutate(() => revokeInvite(item.email, options))}>Revoke</button></div>)}
        {data && data.invites.every((item) => item.status !== "pending") && <p className="text-fg-tertiary">No pending invitations.</p>}
        <p className="pt-1 text-fg-tertiary">Members</p>
        {(data?.members ?? []).map((member) => <div key={member.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-fg-secondary">{member.email}{member.role === "admin" ? " · admin" : ""}</span><button type="button" disabled={busy || member.role === "admin"} className="text-fg-secondary hover:text-fg disabled:opacity-40" onClick={() => void mutate(() => setMemberStatus(member.id, member.status === "active" ? "suspended" : "active", options))}>{member.status === "active" ? "Suspend" : "Restore"}</button></div>)}
        {data?.nextCursor && <button type="button" className="text-fg-secondary hover:text-fg" onClick={() => void loadMore()}>Load more</button>}
      </div>
    </section>
  );
}

function SignedOut({ onSignIn }: { onSignIn: (turnstileToken: string) => Promise<void> | void }) {
  const [showChallenge, setShowChallenge] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = async (token: string) => {
    setBusy(true);
    try {
      await onSignIn(token);
    } catch (error) {
      notify.error(error instanceof PublishClientError ? error.message : "Could not start sign-in.");
      setBusy(false);
    }
  };
  return (
    <div className="mt-4">
      <p className="text-xs text-fg-secondary">
        Publishing needs an account so the public copy has an owner who can update or remove it.
        Nothing else in Precipice requires signing in.
      </p>
      <div className="mt-3">
        {!showChallenge ? (
          <Primary onClick={() => setShowChallenge(true)}>Continue with Google</Primary>
        ) : (
          <TurnstileChallenge disabled={busy} onToken={start} />
        )}
      </div>
    </div>
  );
}

function PublicUrl({ url }: { url: string }) {
  const href = new URL(url, window.location.origin).toString();
  return (
    <div className="mt-4 flex items-center gap-2 rounded-md bg-inset px-2.5 py-2">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mono min-w-0 flex-1 truncate text-accent underline-offset-2 hover:underline"
      >
        {href}
      </a>
      <button
        type="button"
        className="shrink-0 rounded-sm px-1.5 py-0.5 text-2xs text-fg-secondary hover:bg-active"
        onClick={() => {
          void navigator.clipboard?.writeText(href).then(
            () => notify.success("Link copied."),
            () => notify.error("Could not copy the link."),
          );
        }}
      >
        Copy
      </button>
    </div>
  );
}

/**
 * The slot count, and — when it is full — which scapes are holding the slots. A limit that
 * only says "you have hit a limit" leaves the user to go hunting.
 */
function Quota({ list }: { list: PublicationList }) {
  const full = list.used >= list.limit;
  const mib = (list.storedBytes / (1024 * 1024)).toFixed(list.storedBytes >= 10 * 1024 * 1024 ? 0 : 1);
  return (
    <p className={`mt-3 text-2xs ${full ? "text-fg-secondary" : "text-fg-tertiary"}`}>
      <span className="mono">
        {list.activeUsed} public · {list.used} of {list.limit} retained slots
      </span>{" "}
      · {mib} MiB stored{full ? ". Delete a retained publication to free a slot." : "."}
    </p>
  );
}

type TurnstileApi = {
  render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; "error-callback": () => void; "expired-callback": () => void }) => string;
  remove: (widgetId: string) => void;
};

function TurnstileChallenge({ disabled, onToken }: { disabled: boolean; onToken: (token: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!sitekey || !element.current) return;
    const render = () => {
      const api = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (!api || !element.current || widget.current) return;
      widget.current = api.render(element.current, {
        sitekey,
        action: "publish-auth",
        callback: onToken,
        "error-callback": () => notify.error("Security check failed to load. Please retry."),
        "expired-callback": () => notify.error("Security check expired. Please retry."),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="publish-auth"]');
    if (existing) {
      if ((window as Window & { turnstile?: TurnstileApi }).turnstile) render();
      else existing.addEventListener("load", render, { once: true });
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "publish-auth";
      script.addEventListener("load", render, { once: true });
      document.head.append(script);
    }
    return () => {
      const api = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (api && widget.current) api.remove(widget.current);
      widget.current = null;
    };
  }, [sitekey, onToken]);

  if (!sitekey) return <p className="text-2xs text-fg-secondary">Sign-in security check is not configured yet.</p>;
  return <div className={disabled ? "pointer-events-none opacity-60" : ""} ref={element} aria-label="Security check" />;
}

function Primary({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition-colors duration-fast hover:bg-accent-hover disabled:opacity-50"
    >
      {busy ? "Working…" : children}
    </button>
  );
}

function Secondary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-default px-3 py-1.5 text-xs text-fg-secondary transition-colors duration-fast hover:bg-active disabled:opacity-50"
    >
      {children}
    </button>
  );
}
