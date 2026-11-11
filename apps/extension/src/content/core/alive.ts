/** False after the extension was reloaded or removed while this page stayed open. */
export function isAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}   