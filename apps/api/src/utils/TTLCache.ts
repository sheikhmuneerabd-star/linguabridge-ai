interface Entry<V> {
  value: V;
  expires: number;
}

export class TTLCache<V> {
  private map = new Map<string, Entry<V>>();

  constructor(
    private maxEntries: number,
    private ttlMs: number
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (entry.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }

    // Move to the end so recently used entries are removed last.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });

    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}