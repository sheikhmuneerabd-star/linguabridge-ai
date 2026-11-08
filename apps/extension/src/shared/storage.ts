export const TOKEN_KEY = "lb_token";
/** Changes every time preferences are saved, so other windows (side panel) can refresh. */
export const PREFS_TS_KEY = "lb_prefs_updated";
/** true = the user turned on automatic translation of Fiverr messages. Off by default. */
export const CONSENT_KEY = "lb_auto_translate_v1";
/** true = the user turned on translation of the reply they type. Off by default. */
export const REPLY_KEY = "lb_reply_translate_v1";

export async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return (result[TOKEN_KEY] as string | undefined) ?? null;
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}