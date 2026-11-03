"use client";

import { useState } from "react";
import { LANGUAGES, TONES, type Preferences, type Tone } from "@linguabridge/shared";

const TONE_LABELS: Record<Tone, string> = {
  professional: "Professional",
  friendly: "Friendly",
  formal: "Formal",
  confident: "Confident",
  persuasive: "Persuasive",
};

interface Props {
  initial: Preferences;
  submitLabel: string;
  onSave: (values: Pick<Preferences, "displayLanguage" | "writingLanguage" | "tone">) => Promise<void>;
}

export function PreferencesForm({ initial, submitLabel, onSave }: Props) {
  const [displayLanguage, setDisplayLanguage] = useState(initial.displayLanguage);
  const [writingLanguage, setWritingLanguage] = useState(initial.writingLanguage);
  const [tone, setTone] = useState<Tone>(initial.tone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ displayLanguage, writingLanguage, tone });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const selectClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="display" className="mb-1 block font-medium">
          I want to read messages in
        </label>
        <select
          id="display"
          className={selectClass}
          value={displayLanguage}
          onChange={(e) => setDisplayLanguage(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="writing" className="mb-1 block font-medium">
          I will write my replies in
        </label>
        <select
          id="writing"
          className={selectClass}
          value={writingLanguage}
          onChange={(e) => setWritingLanguage(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="mb-2 font-medium">My communication style</legend>
        <div className="flex flex-wrap gap-2">
          {TONES.map((t) => (
            <label
              key={t}
              className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${
                tone === t
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-300 bg-white hover:bg-slate-100"
              }`}
            >
              <input
                type="radio"
                name="tone"
                value={t}
                checked={tone === t}
                onChange={() => setTone(t)}
                className="sr-only"
              />
              {TONE_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {saving ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}