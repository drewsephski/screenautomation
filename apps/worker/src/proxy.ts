import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { publicAddresses } from "@repo/jobs/security";

/** Every HTTPS destination, including redirects, needs a CONNECT tunnel. Dial
 * only the previously validated public IP, never a second DNS resolution. */
export async function startEgressProxy(destinations: Record<string, string[]>) {
  for (const [origin, addresses] of Object.entries(destinations)) {
    if (
      new URL(origin).origin !== origin ||
      new URL(origin).protocol !== "https:" ||
      !addresses.length
    )
      throw new Error("Invalid proxy destination");
    for (const address of addresses) {
      if (address.includes(":")) throw new Error("Proxy requires IPv4 pins");
      await publicAddresses(`https://${address}`);
    }
  }
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.writeHead(403);
    response.end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("connect", (request, client, head) => {
    let origin: string;
    try {
      const url = new URL(`https://${request.url}`);
      if (url.username || url.password || url.port || url.pathname !== "/")
        throw new Error();
      origin = url.origin;
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const addresses = destinations[origin];
    if (!addresses?.length) {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = connect({ host: addresses[0]!, port: 443, family: 4 });
    sockets.add(upstream);
    upstream.setTimeout(180000, () => upstream.destroy());
    const connectTimeout = setTimeout(() => upstream.destroy(), 10000);
    upstream.once("connect", () => {
      clearTimeout(connectTimeout);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => {
      clearTimeout(connectTimeout);
      sockets.delete(upstream);
      client.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Proxy did not start");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
