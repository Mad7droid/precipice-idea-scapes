import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * `public/sw.js` decides what every later request is allowed to use from cache, and it does
 * it in a context no other test touches. Its failure mode is silent: a wrong answer shows a
 * stale or entirely wrong page, with no error anybody reports.
 *
 * The rule under test arrived with publishing. `/p/<id>` and `/embed/<id>` are a stranger's
 * document served from the viewer bundle; the shell's offline fallback is the *editor*. Left
 * ungated, an offline published link renders the reader their own app in place of the
 * document they followed a link to.
 *
 * The file is a classic script, not a module, so it is evaluated here against a stub `self`
 * rather than imported.
 */
const source = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");

interface Harness {
  fetchEvent(
    url: string,
    init?: { mode?: string; method?: string },
  ): {
    responded: boolean;
    responsePromise: Promise<Response> | undefined;
  };
  cache: Map<string, Response>;
  network: { fail: boolean; calls: string[] };
}

function load(): Harness {
  const cache = new Map<string, Response>();
  const network = { fail: false, calls: [] as string[] };
  const listeners = new Map<string, (event: unknown) => void>();

  const self = {
    location: { origin: "https://precipice.pages.dev" },
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      listeners.set(type, handler),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };

  const caches = {
    keys: () => Promise.resolve([...cache.keys()]),
    delete: () => Promise.resolve(true),
    open: () => Promise.resolve({ put: () => Promise.resolve() }),
    match: (request: string | { url: string }) => {
      const key = typeof request === "string" ? request : new URL(request.url).pathname;
      return Promise.resolve(cache.get(key));
    },
  };

  const fetchStub = (request: { url: string }) => {
    network.calls.push(request.url);
    if (network.fail) return Promise.reject(new Error("offline"));
    return Promise.resolve(new Response("network", { status: 200 }));
  };

  // eslint-disable-next-line no-new-func -- evaluating the worker is the point of the test
  new Function("self", "caches", "fetch", source)(self, caches, fetchStub);

  return {
    cache,
    network,
    fetchEvent(url, init = {}) {
      const state = {
        responded: false,
        responsePromise: undefined as Promise<Response> | undefined,
      };
      listeners.get("fetch")!({
        request: { url, mode: init.mode ?? "navigate", method: init.method ?? "GET" },
        respondWith(promise: Promise<Response>) {
          state.responded = true;
          state.responsePromise = promise;
        },
      });
      return state;
    },
  };
}

describe("service worker", () => {
  let sw: Harness;
  beforeEach(() => {
    sw = load();
  });

  it("bumps the cache name so installs from the previous shape are dropped", () => {
    expect(source).toContain('const CACHE = "precipice-v2"');
  });

  for (const path of ["/p/pub_abc", "/embed/pub_abc", "/p/pub_abc/anything"]) {
    it(`does not handle ${path} at all — published content is not ours to cache`, () => {
      const event = sw.fetchEvent(`https://precipice.pages.dev${path}`);
      expect(event.responded).toBe(false);
    });
  }

  it("still handles an editor navigation", () => {
    expect(sw.fetchEvent("https://precipice.pages.dev/").responded).toBe(true);
    expect(sw.fetchEvent("https://precipice.pages.dev/#/s/scape_1").responded).toBe(true);
  });

  it("does not mistake a path merely starting with those letters for a public one", () => {
    expect(sw.fetchEvent("https://precipice.pages.dev/preferences").responded).toBe(true);
    expect(sw.fetchEvent("https://precipice.pages.dev/embedded-thing").responded).toBe(true);
  });

  it("ignores cross-origin requests, so the AI proxy is never cached", () => {
    const event = sw.fetchEvent("https://precipice-ai-proxy.precipice.workers.dev/v1/messages");
    expect(event.responded).toBe(false);
  });

  it("falls back to the editor shell for an offline editor navigation", async () => {
    sw.cache.set("/index.html", new Response("shell", { status: 200 }));
    sw.network.fail = true;

    const event = sw.fetchEvent("https://precipice.pages.dev/");
    await expect(event.responsePromise!.then((r) => r.text())).resolves.toBe("shell");
  });

  it("never serves the editor shell in place of a published scape", () => {
    sw.cache.set("/index.html", new Response("shell", { status: 200 }));
    sw.network.fail = true;

    // The request is not handled at all, so there is nothing to fall back with.
    expect(sw.fetchEvent("https://precipice.pages.dev/p/pub_abc").responded).toBe(false);

    // The fallback is independently path-gated. No code path reaches that guard in a passing
    // build — which is exactly why it is worth pinning: it is the second line of defence for
    // a bug whose only symptom is the wrong page.
    expect(source).toContain("offline: published scapes are not cached");
  });
});
