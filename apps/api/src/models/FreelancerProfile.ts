import { Schema, model } from "mongoose";

const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    displayName: { type: String, default: "" },
    intro: { type: String, default: "" },
    skills: { type: [String], default: [] },
    technologies: { type: [String], default: [] },
    services: { type: [String], default: [] },
    experience: { type: String, default: "" },
    capabilities: { type: String, default: "" },
    portfolioLinks: { type: [String], default: [] },
    pricingNotes: { type: String, default: "" },
    deliveryNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

export const ProfileModel = model("FreelancerProfile", schema);