import { Daytona } from "@daytonaio/sdk";
import { build } from "esbuild";
import { publicAddresses } from "@repo/jobs/security";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

if (!process.env.DAYTONA_API_KEY || !process.env.DAYTONA_SNAPSHOT)
  throw new Error("DAYTONA_API_KEY and DAYTONA_SNAPSHOT are required.");
const directory = resolve("../../artifacts/network-controls");
await mkdir(directory, { recursive: true, mode: 0o700 });
await build({
  entryPoints: ["src/proxy.ts"],
  outfile: join(directory, "proxy.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
const origins = [
  "https://kraftybot.app",
  "https://clerk.kraftybot.app",
  "https://img.clerk.com",
  "https://api.trigger.dev",
  "https://cdn.protect.clerk.com",
];
const destinations = Object.fromEntries(
  await Promise.all(
    origins.map(async (origin) => [
      origin,
      (await publicAddresses(origin))
        .filter((cidr) => !cidr.includes(":"))
        .map((cidr) => cidr.split("/")[0]),
    ]),
  ),
);
if (Object.values(destinations).some((addresses) => !addresses.length))
  throw new Error(
    "Every approved origin must resolve to a public IPv4 address.",
  );
const cidrs = [
  ...new Set(
    Object.values(destinations)
      .flat()
      .map((address) => `${address}/32`),
  ),
];
if (!cidrs.length || cidrs.length > 9)
  throw new Error(
    "Network-control test needs at most nine approved CIDRs plus its public control.",
  );
const client = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  otelEnabled: false,
  requestTimeoutMs: 30000,
});
const report = {
  purpose: "unauthenticated-krafty-and-direct-tcp-firewall-controls",
  snapshot: process.env.DAYTONA_SNAPSHOT,
  startedAt: new Date().toISOString(),
  sandboxId: null,
  cleanupVerified: false,
  credentialsSubmitted: false,
  protocol: "tcp",
  port: 443,
  probeTransport:
    "node:net.connect to numeric IPv4; no HTTP client, DNS, browser, or proxy",
  observations: [],
};
let sandbox;
let failure;
try {
  sandbox = await client.create(
    {
      snapshot: process.env.DAYTONA_SNAPSHOT,
      name: `screen-studio-network-${Date.now()}`,
      public: false,
      networkAllowList: cidrs.join(","),
      autoStopInterval: 5,
      autoDeleteInterval: 0,
      ttlMinutes: 10,
      labels: { app: "screen-studio", purpose: "network-controls" },
      envVars: { DISPLAY: ":0", VNC_RESOLUTION: "1920x1080" },
    },
    { timeout: 90 },
  );
  report.sandboxId = sandbox.id;
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  const probeSource = `import {connect} from 'node:net';
const hosts=JSON.parse(process.argv[2]);
const observations=await Promise.all(hosts.map(host=>new Promise(resolve=>{const start=performance.now();const socket=connect({host,port:443,family:4});const finish=(connected,error)=>{socket.removeAllListeners();socket.destroy();resolve({host,port:443,protocol:'tcp',connected,error,elapsedMs:Math.round(performance.now()-start)});};socket.setTimeout(3000);socket.once('connect',()=>finish(true,null));socket.once('error',error=>finish(false,error.code??error.name));socket.once('timeout',()=>finish(false,'TIMEOUT'));})));
console.log(JSON.stringify(observations));`;
  await sandbox.fs.uploadFile(
    Buffer.from(probeSource),
    "/opt/capture/probe.mjs",
  );
  async function probe(phase, hosts) {
    // All destinations are fixed public/private numeric controls below; no page
    // content or user string can choose a privileged command.
    const result = await sandbox.process.executeCommand(
      `node probe.mjs '${JSON.stringify(hosts)}'`,
      "/opt/capture",
      undefined,
      10,
    );
    if (result.exitCode !== 0) throw new Error("Direct probe process failed");
    const observations = JSON.parse(result.result);
    report.observations.push({
      phase,
      cidrs:
        phase === "public-control-allowed" ? [...cidrs, "1.1.1.1/32"] : cidrs,
      results: observations,
    });
    return observations;
  }
  const baseline = await probe("restricted", [
    destinations[origins[0]][0],
    "1.1.1.1",
    "169.254.169.254",
    "10.0.0.1",
  ]);
  if (
    !baseline[0].connected ||
    baseline.slice(1).some((result) => result.connected)
  )
    throw new Error("Baseline public/denied controls failed");
  await sandbox.updateNetworkSettings({
    networkAllowList: [...cidrs, "1.1.1.1/32"].join(","),
  });
  const allowed = await probe("public-control-allowed", ["1.1.1.1"]);
  if (!allowed[0].connected)
    throw new Error(
      "Temporarily approved public control is unreachable; firewall claim cannot be verified",
    );
  await sandbox.updateNetworkSettings({ networkAllowList: cidrs.join(",") });
  const restored = await probe("restriction-restored", ["1.1.1.1"]);
  if (restored[0].connected)
    throw new Error(
      "Public control remained reachable after restoring restriction",
    );
  await sandbox.fs.uploadFile(
    join(directory, "proxy.mjs"),
    "/opt/capture/proxy.mjs",
  );
  await sandbox.fs.uploadFile(
    Buffer.from(JSON.stringify(destinations)),
    "/tmp/destinations.json",
  );
  const browserSource = `import {chromium} from 'playwright';import {startEgressProxy} from './proxy.mjs';import {readFile,writeFile} from 'node:fs/promises';
const proxy=await startEgressProxy(JSON.parse(await readFile('/tmp/destinations.json','utf8')));
const browser=await chromium.launch({headless:false,proxy:{server:proxy.url,bypass:'<-loopback>'},args:['--disable-http2','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
try{const context=await browser.newContext({viewport:{width:1920,height:1080},locale:'en-US',timezoneId:'UTC',serviceWorkers:'block'});const page=await context.newPage();await page.goto('https://kraftybot.app/sign-in?redirect_url=%2Fworkspace',{waitUntil:'domcontentloaded',timeout:30000});await page.locator('input[name=identifier],input[type=email],input[autocomplete=username]').first().waitFor({state:'visible',timeout:45000});await writeFile('/tmp/login-control.json',JSON.stringify({formReady:true,finalOrigin:new URL(page.url()).origin,browser:browser.version(),credentialsSubmitted:false}));}finally{await browser.close();await proxy.close();}`;
  await sandbox.fs.uploadFile(
    Buffer.from(browserSource),
    "/opt/capture/login-control.mjs",
  );
  await sandbox.computerUse.start();
  const login = await sandbox.process.executeCommand(
    "node login-control.mjs",
    "/opt/capture",
    { DISPLAY: ":0" },
    90,
  );
  if (login.exitCode !== 0)
    throw new Error("Krafty login positive control failed");
  report.login = JSON.parse(
    (await sandbox.fs.downloadFile("/tmp/login-control.json")).toString(),
  );
  console.log(
    JSON.stringify({
      status: "network-controls-passed",
      sandboxId: sandbox.id,
      observations: report.observations,
      login: report.login,
    }),
  );
} catch (error) {
  failure = error;
} finally {
  try {
    if (sandbox) {
      await client.delete(sandbox, 30, true);
      report.cleanupVerified = true;
    }
  } catch (error) {
    failure = error;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
if (failure) {
  console.error(
    JSON.stringify({
      status: "failed",
      type: failure.constructor.name,
      message: String(failure.message)
        .replaceAll(process.env.DAYTONA_API_KEY, "[redacted]")
        .slice(0, 500),
    }),
  );
  process.exitCode = 1;
}
