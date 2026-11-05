import { createApp } from "./app";
import { connectDB, disconnectDB } from "./config/db";
import { env } from "./config/env";
import { User } from "./models/User";

async function main() {
  await connectDB();

  // Makes the database indexes match the User model (fixes an old non-sparse googleId index).
  await User.syncIndexes().catch((err: Error) =>
    console.warn("Could not sync User indexes:", err.message)
  );

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`API running on http://localhost:${env.PORT}`);
  });

  const shutdown = async () => {
    console.log("Shutting down...");
    server.close();
    await disconnectDB();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});