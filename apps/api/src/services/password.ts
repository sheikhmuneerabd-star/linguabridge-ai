import bcrypt from "bcryptjs";

const COST = 12;

// Used when the email doesn't exist, so response time looks the same.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", COST);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function checkPassword(password: string, hash: string | undefined): Promise<boolean> {
  const result = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash ? result : false;
}