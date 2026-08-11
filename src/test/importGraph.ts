import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/**
 * A source-level module-graph walker, for asserting what a bundle *cannot* contain.
 *
 * The public viewer and the editor share an origin and a repository but must not share an
 * import graph: the viewer renders a stranger's document on the same origin that holds the
 * author's scapes and their Anthropic key. `src/viewer/bundle.test.ts` checks that from the
 * built output, which is authoritative but needs a build and only sees whatever `dist/`
 * happens to hold. This checks the source, so a bad import fails in the normal test run next
 * to the line that caused it.
 */
export const REPO_ROOT = resolve(__dirname, "../..");

/** Comments describe these rules; they must not be able to satisfy or violate one. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Runtime imports only. `import type { X } from "y"` is erased by the compiler and cannot pull
 * anything into a bundle, so it is allowed — that is how a `view.ts` names `ViewPlugin` without
 * importing the module that declares it. A mixed clause (`import { type A, b }`) does import at
 * runtime, and is counted.
 */
export function runtimeImports(source: string): string[] {
  const specs: string[] = [];
  const clause = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
  for (const [, binding, spec] of source.matchAll(clause)) {
    if (!/^type[\s{]/.test(binding.trim())) specs.push(spec);
  }
  for (const [, spec] of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    specs.push(spec);
  }
  for (const [, spec] of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.push(spec);
  }
  return specs;
}

/** Repo-relative path of what a specifier resolves to, or null for an external package. */
export function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return null;
  const base = spec.startsWith("@/")
    ? resolve(REPO_ROOT, "src", spec.slice(2))
    : resolve(REPO_ROOT, dirname(fromFile), spec);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (!existsSync(candidate)) continue;
    const rel = relative(REPO_ROOT, candidate);
    // CSS and other assets carry no module graph we care about.
    return /\.(ts|tsx)$/.test(rel) ? rel : null;
  }
  return null;
}

/**
 * Every file reachable from `entries`, mapped to the shortest import path that reached it —
 * so a violation reports the chain, not just the destination.
 */
export function walkImports(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = entries.map((entry) => ({ file: entry, path: [entry] }));

  while (queue.length) {
    const { file, path } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.set(file, path);
    const source = stripComments(readFileSync(resolve(REPO_ROOT, file), "utf8"));
    for (const spec of runtimeImports(source)) {
      const target = resolveSpec(file, spec);
      if (target && !seen.has(target)) queue.push({ file: target, path: [...path, target] });
    }
  }
  return seen;
}

/** Formats each reached file matching a forbidden pattern as `<what> — via a → b → c`. */
export function findViolations(
  reached: Map<string, string[]>,
  forbidden: Array<[RegExp, string]>,
): string[] {
  const violations: string[] = [];
  for (const [file, path] of reached) {
    for (const [pattern, what] of forbidden) {
      if (pattern.test(file)) violations.push(`${what} — via ${path.join(" → ")}`);
    }
  }
  return violations;
}
