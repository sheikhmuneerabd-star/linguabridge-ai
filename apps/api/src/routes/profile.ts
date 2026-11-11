import { Router } from "express";
import { Types } from "mongoose";
import { profileSchema, type FreelancerProfile } from "@linguabridge/shared";
import { requireAuth } from "../middleware/auth";
import { ProfileModel } from "../models/FreelancerProfile";
import { asyncHandler } from "../utils/asyncHandler";

export const profileRouter = Router();

profileRouter.use(requireAuth);

/** Turns a database record (or nothing) into a clean profile with every field present. */
function toProfile(doc: unknown): FreelancerProfile {
  const parsed = profileSchema.safeParse(doc ?? {});
  return parsed.success ? parsed.data : profileSchema.parse({});
}

const owner = (userId: string) => ({ userId: new Types.ObjectId(userId) });

// GET /profile
profileRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const doc = await ProfileModel.findOne(owner(res.locals.userId)).lean();
    res.json({ profile: toProfile(doc), exists: doc !== null });
  })
);

// PUT /profile  (replaces the whole profile)
profileRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const data = profileSchema.parse(req.body);
    const filter = owner(res.locals.userId);

    const save = () =>
      ProfileModel.findOneAndUpdate(filter, { $set: data }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();

    let doc;
    try {
      doc = await save();
    } catch (err) {
      // Two saves created the record at the same moment: just try once more.
      if ((err as { code?: number }).code !== 11000) throw err;
      doc = await save();
    }

    res.json({ profile: toProfile(doc), exists: true });
  })
);

// DELETE /profile
profileRouter.delete(
  "/",
  asyncHandler(async (_req, res) => {
    await ProfileModel.deleteOne(owner(res.locals.userId));
    res.json({ deleted: true });
  })
);