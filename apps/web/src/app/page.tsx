"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthResponse, Preferences, PublicUser } from "@linguabridge/shared";
import { getLanguageName } from "@linguabridge/shared";
import { api, ApiError, clearToken, getToken, setToken } from "@/lib/api";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { PreferencesForm } from "@/components/PreferencesForm";
import { EmailAuthForm, type EmailAuthValues } from "@/components/EmailAuthForm";
import Link from "next/link";

interface MeResponse {
  user: PublicUser;
  preferences: Preferences;
}

type View = "loading" | "signedOut" | "signedIn";

export default function HomePage() {
  const [view, setView] = useState<View>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const data = await api<MeResponse>("/users/me");
      setMe(data);
      setView("signedIn");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) clearToken();
      else if (err instanceof ApiError) setError(err.message);
      setView("signedOut");
    }
  }, []);

  useEffect(() => {
    api<{ status: string }>("/health")
      .then((d) => setServerOnline(d.status === "ok"))
      .catch(() => setServerOnline(false));

    if (getToken()) loadMe();
    else setView("signedOut");
  }, [loadMe]);

  async function handleGoogle(idToken: string) {
    setError(null);
    try {
      const data = await api<AuthResponse>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken }),
      });
      setToken(data.token);
      setView("loading");
      await loadMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
    }
  }

    async function handleEmailAuth(mode: "login" | "register", values: EmailAuthValues) {
    setError(null);
    const body =
      mode === "register"
        ? { name: values.name, email: values.email, password: values.password }
        : { email: values.email, password: values.password };

    const data = await api<AuthResponse>(`/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setToken(data.token);
    setView("loading");
    await loadMe();
  }

  async function savePreferences(
    values: Pick<Preferences, "displayLanguage" | "writingLanguage" | "tone">
  ) {
    const data = await api<{ preferences: Preferences }>("/users/me/preferences", {
      method: "PATCH",
      body: JSON.stringify({ ...values, onboardingDone: true }),
    });
    setMe((prev) => (prev ? { ...prev, preferences: data.preferences } : prev));
    setEditing(false);
  }

  function signOut() {
    clearToken();
    setMe(null);
    setEditing(false);
    setView("signedOut");
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">LinguaBridge AI</h1>
        <p className="text-lg text-slate-600">Talk to international clients without language barriers.</p>
      </header>

      {view === "loading" && <p className="text-slate-500">Loading...</p>}

            {view === "signedOut" && (
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-semibold">Get started</h2>

          <GoogleSignInButton onCredential={handleGoogle} />

          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="h-px flex-1 bg-slate-200" />
            or use email
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <EmailAuthForm onSubmit={handleEmailAuth} />

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </section>
      )}

      {view === "signedIn" && me && !me.preferences.onboardingDone && (
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
          <div>
            <h2 className="text-xl font-semibold">Welcome, {me.user.name.split(" ")[0]}!</h2>
            <p className="text-slate-600">Choose your languages and style once. You can change them anytime.</p>
          </div>
          <PreferencesForm initial={me.preferences} submitLabel="Save and continue" onSave={savePreferences} />
        </section>
      )}

      {view === "signedIn" && me && me.preferences.onboardingDone && (
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3">
            {me.user.picture && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.user.picture} alt="" className="h-12 w-12 rounded-full" referrerPolicy="no-referrer" />
            )}
            <div>
              <p className="font-semibold">{me.user.name}</p>
              <p className="text-sm text-slate-500">{me.user.email}</p>
            </div>
          </div>

          {!editing ? (
            <>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Read messages in</dt>
                  <dd className="font-medium">{getLanguageName(me.preferences.displayLanguage)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Write replies in</dt>
                  <dd className="font-medium">{getLanguageName(me.preferences.writingLanguage)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Style</dt>
                  <dd className="font-medium capitalize">{me.preferences.tone}</dd>
                </div>
              </dl>
              <div className="flex gap-3">
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-100"
                >
                  Change settings
                </button>
                <Link
                  href="/profile"
                  className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-100"
                >
                  Freelancer profile
                </Link>
                <button onClick={signOut} className="rounded-lg px-4 py-2 text-slate-600 hover:bg-slate-100">
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <PreferencesForm initial={me.preferences} submitLabel="Save" onSave={savePreferences} />
          )}
        </section>
      )}

      <footer className="flex items-center gap-2 text-sm text-slate-500">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            serverOnline === null ? "bg-slate-400" : serverOnline ? "bg-green-500" : "bg-red-500"
          }`}
          aria-hidden="true"
        />
        {serverOnline === null ? "Checking server..." : serverOnline ? "Server is online" : "Server is offline"}
      </footer>
    </main>
  );
}