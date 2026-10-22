/** Matches the native vault's refusal message, which is remembered until the person retries. */
export function isKeychainDenied(error: unknown): boolean {
  return String(error).includes("Keychain access was not allowed");
}

/** Asks macOS for Keychain access again. Only call this from an explicit click. */
export async function retryKeychain(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("keychain_retry");
}
