import { Schema, model } from "mongoose";

const usageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true }, // "YYYY-MM-DD" (UTC)
    requests: { type: Number, default: 0 }, // real AI calls
    cacheHits: { type: Number, default: 0 }, // answered without AI
    tokens: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

usageSchema.index({ userId: 1, day: 1 }, { unique: true });
usageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UsageLog = model("UsageLog", usageSchema);