import { z } from "zod";

export const PROFILE_LIMITS = {
  displayName: 80,
  intro: 500,
  experience: 800,
  capabilities: 800,
  pricingNotes: 600,
  deliveryNotes: 600,
  skillsCount: 30,
  itemLength: 40,
  servicesCount: 15,
  serviceLength: 80,
  linksCount: 10,
  linkLength: 300,
} as const;

const text = (max: number) => z.string().trim().max(max).default("");
const list = (count: number, length: number) =>
  z.array(z.string().trim().min(1).max(length)).max(count).default([]);

/** Everything is optional. The AI may only use facts that are written here. */
export const profileSchema = z.object({
  displayName: text(PROFILE_LIMITS.displayName),
  intro: text(PROFILE_LIMITS.intro),
  skills: list(PROFILE_LIMITS.skillsCount, PROFILE_LIMITS.itemLength),
  technologies: list(PROFILE_LIMITS.skillsCount, PROFILE_LIMITS.itemLength),
  services: list(PROFILE_LIMITS.servicesCount, PROFILE_LIMITS.serviceLength),
  experience: text(PROFILE_LIMITS.experience),
  capabilities: text(PROFILE_LIMITS.capabilities),
  portfolioLinks: z
    .array(
      z
        .string()
        .trim()
        .max(PROFILE_LIMITS.linkLength)
        .url()
        // new URL() also accepts things like "javascript:..."; only web links are allowed.
        .refine((u) => /^https?:\/\//i.test(u), "Links must start with http:// or https://")
    )
    .max(PROFILE_LIMITS.linksCount)
    .default([]),
  pricingNotes: text(PROFILE_LIMITS.pricingNotes),
  deliveryNotes: text(PROFILE_LIMITS.deliveryNotes),
});

export type FreelancerProfile = z.infer<typeof profileSchema>;