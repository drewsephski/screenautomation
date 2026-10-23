import { build } from "esbuild";
await build({
  entryPoints: ["src/remote.ts"],
  outfile: "dist/remote.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["playwright", "playwright/*"],
});

await build({
  entryPoints: ["src/media.ts"],
  outfile: "dist/remote-analysis.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
