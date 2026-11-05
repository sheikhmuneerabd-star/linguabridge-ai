import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");

/** Tiny .env reader (KEY=VALUE per line). */
function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = loadDotEnv(".env");
const get = (key, fallback = "") => process.env[key] ?? fileEnv[key] ?? fallback;

const API_URL = get("LB_API_URL", "http://localhost:4000").replace(/\/+$/, "");
const GOOGLE_CLIENT_ID = get("LB_GOOGLE_CLIENT_ID");
const apiPattern = `${new URL(API_URL).origin}/*`;

if (!GOOGLE_CLIENT_ID) {
  console.warn("WARNING: LB_GOOGLE_CLIENT_ID is empty. Google sign-in will not work (add it to apps/extension/.env).");
}

function copyStatic() {
  mkdirSync("dist", { recursive: true });
  cpSync("src/static", "dist", { recursive: true });

  const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  // The only host the extension may call: our own API.
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), apiPattern])];
  writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
  console.log(`Static files and manifest copied (API: ${API_URL})`);
}

const staticPlugin = {
  name: "static",
  setup(build) {
    build.onEnd(() => copyStatic());
  },
};

const options = {
  entryPoints: {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    popup: "src/popup/popup.ts",
    sidepanel: "src/sidepanel/sidepanel.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome114",
  sourcemap: true,
  logLevel: "info",
  define: {
    __API_URL__: JSON.stringify(API_URL),
    __GOOGLE_CLIENT_ID__: JSON.stringify(GOOGLE_CLIENT_ID),
  },
  plugins: [staticPlugin],
};

rmSync("dist", { recursive: true, force: true });

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching for changes... (after each rebuild, click the reload icon on chrome://extensions)");
} else {
  await esbuild.build(options);
}