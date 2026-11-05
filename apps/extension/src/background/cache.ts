const KEY = "lb_cache";
const MAX_ENTRIES = 200;
const TTL_MS = 30 * 60_000;

interface Entry {
  v: unknown;
  t: number;
}
type Store = Record<string, Entry>;

async function readStore(): Promise<Store> {
  const raw = (await chrome.storage.session.get(KEY))[KEY] as Store | undefined;
  return raw ?? {};
}

export class TranslationCache {
  private queue: Promise<unknown> = Promise.resolve();

  /** Runs jobs one after another, so two writes never overwrite each other. */
  private run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => job());
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  get<T>(key: string): Promise<T | undefined> {
    return this.run(async () => {
      const entry = (await readStore())[key];
      if (!entry || Date.now() - entry.t > TTL_MS) return undefined;
      return entry.v as T;
    });
  }

  set(key: string, value: unknown): Promise<void> {
    return this.run(async () => {
      const store = await readStore();
      const now = Date.now();

      for (const [k, e] of Object.entries(store)) {
        if (now - e.t > TTL_MS) delete store[k];
      }
      store[key] = { v: value, t: now };

      const keys = Object.keys(store);
      if (keys.length > MAX_ENTRIES) {
        keys
          .sort((a, b) => store[a].t - store[b].t)
          .slice(0, keys.length - MAX_ENTRIES)
          .forEach((k) => delete store[k]);
      }
      await chrome.storage.session.set({ [KEY]: store });
    });
  }

  clear(): Promise<void> {
    return this.run(() => chrome.storage.session.remove(KEY));
  }
}