/**
 * Ids are user-visible: the canvas renders an object's id in mono at the bottom of the card.
 * They should stay short and readable. Model-authored ids (slugs) are accepted as-is.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function rand(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const newObjectId = (): string => `obj_${rand(8)}`;
export const newRelId = (): string => `rel_${rand(8)}`;
export const newScapeId = (): string => `scp_${rand(8)}`;
export const newTxId = (): string => `tx_${rand(10)}`;

/** Deterministic slug for ids the model supplies as prose. Not used for generated ids. */
export function slugId(input: string, fallbackPrefix = "obj"): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || `${fallbackPrefix}_${rand(8)}`;
}
