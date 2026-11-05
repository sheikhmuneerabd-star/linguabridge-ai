// Both are replaced by esbuild at build time (see build.mjs).
declare const __API_URL__: string;
declare const __GOOGLE_CLIENT_ID__: string;

export const API_URL: string = __API_URL__;
export const GOOGLE_CLIENT_ID: string = __GOOGLE_CLIENT_ID__;