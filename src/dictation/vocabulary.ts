import type { Scape } from "@/core/types";

/** Whisper reads at most ~224 prompt tokens; the native side also caps the length. */
const MAX_CHARS = 600;

/**
 * Words this scape is likely to hear: its own name, its card titles and tags. Passed to the
 * recogniser as a prompt so "Scapi", product names and people's names come out spelled the way
 * the canvas already spells them. Never sent anywhere — the engine is on this device.
 */
export function dictationVocabulary(scape: Scape | null): string {
  const words = new Set<string>(["Precipice", "Scapi", "scape"]);
  if (scape) {
    words.add(scape.name.trim());
    for (const id of scape.objectOrder) {
      const object = scape.objects[id];
      if (!object) continue;
      words.add(object.title.trim());
      for (const tag of object.tags ?? []) words.add(tag.trim());
    }
  }
  let prompt = "";
  for (const word of words) {
    if (!word) continue;
    const next = prompt ? `${prompt}, ${word}` : word;
    if (next.length > MAX_CHARS) break;
    prompt = next;
  }
  return prompt;
}

/** Appends a dictated phrase to whatever is already typed, with one space between. */
export function appendPhrase(current: string, phrase: string): string {
  const text = phrase.trim();
  if (!text) return current;
  if (!current.trim()) return text;
  return /\s$/.test(current) ? current + text : `${current} ${text}`;
}
