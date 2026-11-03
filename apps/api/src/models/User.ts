import { Schema, model, type InferSchemaType } from "mongoose";
import { LANGUAGE_CODES, TONES } from "@linguabridge/shared";

const preferencesSchema = new Schema(
  {
    displayLanguage: { type: String, enum: LANGUAGE_CODES, default: "ur-Latn" },
    writingLanguage: { type: String, enum: LANGUAGE_CODES, default: "ur-Latn" },
    tone: { type: String, enum: TONES, default: "professional" },
    autoTranslate: { type: Boolean, default: true },
    onboardingDone: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    // Optional: only set for users who signed in with Google.
    googleId: { type: String, unique: true, sparse: true },
    // Optional: only set for users who registered with email + password.
    passwordHash: { type: String, select: false },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    picture: { type: String },
    preferences: { type: preferencesSchema, default: () => ({}) },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model("User", userSchema);