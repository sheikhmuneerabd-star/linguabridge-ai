import type { PlatformAdapter } from "../core/types";
import { FiverrAdapter } from "./fiverr";

/** To support another platform later, add its adapter here. */
const adapters: PlatformAdapter[] = [new FiverrAdapter()];

export function findAdapter(url: URL): PlatformAdapter | null {
  return adapters.find((a) => a.matchesUrl(url)) ?? null;
}