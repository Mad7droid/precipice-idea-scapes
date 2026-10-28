/** The subset of Durable Object storage the relay needs to remember spent ticket nonces. */
export interface NonceStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(keys: string[]): Promise<number | boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

const PREFIX = "ticket:";

/**
 * Records a relay ticket's nonce and returns false if it was already spent. Spent nonces are
 * kept only until their ticket would have expired anyway, so storage stays bounded.
 */
export async function claimNonce(
  storage: NonceStorage,
  nonce: string,
  expiresAt: number,
  now = Date.now(),
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(nonce) || !(expiresAt > now)) return false;
  const key = PREFIX + nonce;
  if ((await storage.get<number>(key)) !== undefined) return false;
  await storage.put(key, expiresAt);
  const expired = [...(await storage.list<number>({ prefix: PREFIX }))]
    .filter(([, until]) => until <= now)
    .map(([stale]) => stale);
  if (expired.length) await storage.delete(expired);
  return true;
}
