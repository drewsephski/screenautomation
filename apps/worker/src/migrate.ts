import { RunStore } from "@repo/jobs";
const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required");
const store = new RunStore(databaseUrl);
try {
  await store.migrate();
  console.log("Capture schema is ready.");
} finally {
  await store.close();
}
