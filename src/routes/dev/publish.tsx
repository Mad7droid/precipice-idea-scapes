import { useMemo, useState } from "react";
import { fixtureScape } from "@/core/fixtures";
import type { PublicationRecord, Scape, ScapeId } from "@/core/types";
import {
  PublishClientError,
  createPublication,
  deletePublication,
  listPublications,
  republish,
  unpublish,
  updatePublication,
} from "@/publish/client";
import { PUBLICATION_LIMIT, type PublicationList } from "@/publish/contract";
import { projectScape } from "@/publish/project";
import { PublishStub } from "@/publish/stub";
import { describeState, usePublication } from "@/publish/usePublication";

/**
 * The publishing lifecycle, end to end, with no Worker and no Google account.
 *
 * `PublishStub` implements `contract.ts` and holds real state, so every branch the UI has to
 * handle is reachable here — including the quota 409, which on a real server needs five
 * publications and an account to hit.
 */
export function DevPublish() {
  const [stub] = useState(() => new PublishStub({ token: null }));
  const [scape, setScape] = useState<Scape>(() => fixtureScape());
  const [publications, setPublications] = useState<PublicationList | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [signedIn, setSignedIn] = useState(false);

  const repository = useMemo(() => new MemoryPublications(), []);
  const publication = usePublication(scape, repository);

  const options = useMemo(
    () => ({
      ...(stub.token ? { token: stub.token } : {}),
      fetchImpl: stub.fetch as unknown as typeof fetch,
    }),
    [stub, signedIn, publication.state.kind],
  );

  const say = (line: string) => setLog((lines) => [`${stamp()} ${line}`, ...lines].slice(0, 40));

  const attempt = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
      say(`✓ ${label}`);
    } catch (error) {
      const code = error instanceof PublishClientError ? error.code : "unknown";
      say(`✗ ${label} — ${code}: ${(error as Error).message}`);
    }
    try {
      setPublications(await listPublications(options));
    } catch {
      setPublications(null);
    }
    publication.refresh();
  };

  const projection = projectScape(scape);

  return (
    <div className="h-full overflow-auto bg-base px-8 py-10">
      <div className="mx-auto max-w-[820px]">
        <span className="mono">dev harness</span>
        <h1 className="mt-2 text-2xl text-fg">Publishing</h1>
        <p className="mt-2 text-fg-secondary">
          Driven against an in-memory Worker implementing <span className="mono">contract.ts</span>
          . Nothing here touches the network, a Google account, or your real publications.
        </p>

        <Section title="State">
          <Row label="Publication">{describeState(publication.state)}</Row>
          <Row label="Local hash">
            <span className="mono">{publication.localHash?.slice(0, 16) ?? "…"}</span>
          </Row>
          <Row label="Signed in">{stub.token ? "yes" : "no"}</Row>
          <Row label="Slots">
            <span className="mono">
              {publications ? `${publications.used} of ${publications.limit}` : "—"}
            </span>
          </Row>
          <Row label="Objects">
            <span className="mono">
              {projection.scape.objects.length} published, {projection.skipped.length} skipped
            </span>
          </Row>
        </Section>

        <Section title="Session">
          <Button
            onClick={() =>
              void attempt("sign in", async () => {
                const { exchange } = await import("@/publish/client");
                await exchange("dev-code-0000000000000000", {
                  fetchImpl: stub.fetch as unknown as typeof fetch,
                });
                setSignedIn(true);
              })
            }
          >
            Sign in
          </Button>
          <Button
            onClick={() => {
              stub.token = null;
              setSignedIn(false);
              say("signed out");
            }}
          >
            Sign out
          </Button>
        </Section>

        <Section title="Lifecycle">
          <Button
            onClick={() =>
              void attempt("publish", async () =>
                publication.record(await createPublication(projection.scape, options)),
              )
            }
          >
            Publish
          </Button>
          <Button
            onClick={() =>
              void attempt("update", async () => {
                const state = publication.state;
                if (state.kind === "unpublished") throw new Error("nothing published");
                await publication.record(
                  await updatePublication(state.record.publicationId, projection.scape, options),
                );
              })
            }
          >
            Update
          </Button>
          <Button
            onClick={() =>
              void attempt("unpublish", async () => {
                const state = publication.state;
                if (state.kind === "unpublished") throw new Error("nothing published");
                await publication.record(await unpublish(state.record.publicationId, options));
              })
            }
          >
            Unpublish
          </Button>
          <Button
            onClick={() =>
              void attempt("republish", async () => {
                const state = publication.state;
                if (state.kind === "unpublished") throw new Error("nothing published");
                await publication.record(await republish(state.record.publicationId, options));
              })
            }
          >
            Republish
          </Button>
          <Button
            onClick={() =>
              void attempt("delete", async () => {
                const state = publication.state;
                if (state.kind === "unpublished") throw new Error("nothing published");
                await deletePublication(state.record.publicationId, options);
                await publication.forget();
              })
            }
          >
            Delete
          </Button>
        </Section>

        <Section title="Provoke">
          <Button
            onClick={() => {
              const next = fixtureScape();
              next.objects.brief.title = `Edited at ${stamp()}`;
              setScape(next);
              say("edited the scape — the public copy is now behind");
            }}
          >
            Edit the scape
          </Button>
          <Button
            onClick={() =>
              void attempt("fill every slot", async () => {
                for (let i = 0; i < PUBLICATION_LIMIT + 1; i++) {
                  const other = fixtureScape();
                  other.name = `Filler ${i}`;
                  await createPublication(projectScape(other).scape, options);
                }
              })
            }
          >
            Fill the quota (expects 409)
          </Button>
          <Button
            onClick={() => {
              const next = fixtureScape();
              // An object the registry does not know: the projection must skip it rather than
              // letting the Worker reject the whole payload.
              next.objects.ghost = {
                id: "ghost",
                type: "hologram",
                title: "From a newer build",
                data: {},
                x: 0,
                y: 0,
                createdAt: 0,
                updatedAt: 0,
              };
              next.objectOrder.push("ghost");
              setScape(next);
              say("added an unpublishable block");
            }}
          >
            Add an unknown type
          </Button>
        </Section>

        <Section title="Log">
          <ol className="w-full space-y-0.5">
            {log.length === 0 && <li className="text-fg-tertiary">Nothing yet.</li>}
            {log.map((line, i) => (
              <li key={i} className="mono">
                {line}
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}

/** The Dexie row store, in memory, so the harness never writes to the real database. */
class MemoryPublications {
  private rows = new Map<ScapeId, PublicationRecord>();
  readonly publications = {
    get: async (scapeId: ScapeId) => this.rows.get(scapeId),
    all: async () => [...this.rows.values()],
    put: async (record: PublicationRecord) => void this.rows.set(record.scapeId, record),
    remove: async (scapeId: ScapeId) => void this.rows.delete(scapeId),
  };
}

const stamp = () => new Date().toISOString().slice(11, 19);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mono mb-2">{title}</h2>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-subtle bg-surface p-3">
        {children}
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[160px]">
      <span className="block text-2xs text-fg-tertiary">{label}</span>
      <span className="text-fg">{children}</span>
    </div>
  );
}

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-default px-3 py-1.5 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}
