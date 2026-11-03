"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export function GoogleSignInButton({ onCredential }: { onCredential: (idToken: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  const setup = useCallback(() => {
    if (!CLIENT_ID || !window.google || !containerRef.current) return;

    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: (response) => callbackRef.current(response.credential),
    });
    window.google.accounts.id.renderButton(containerRef.current, {
      theme: "outline",
      size: "large",
      text: "continue_with",
      width: 280,
    });
  }, []);

  // If the script was already loaded earlier, set up immediately.
  useEffect(() => {
    if (window.google) setup();
  }, [setup]);

  if (!CLIENT_ID) {
    return (
      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
        Google sign-in is not set up. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to apps/web/.env.local and restart.
      </p>
    );
  }

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={setup} />
      <div ref={containerRef} />
    </>
  );
}