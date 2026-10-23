import { RunStore } from "@repo/jobs";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const store = new RunStore(process.env.DATABASE_URL);
try {
  await store.migrate();
  console.log("Capture schema is ready.");
} finally {
  await store.close();
}
