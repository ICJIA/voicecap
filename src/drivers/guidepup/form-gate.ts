/**
 * The wall behind the forms pass: a small forward proxy on this computer, which is the only way a
 * browser launched with it can reach the network. The page loads through it as usual. Shutting it,
 * before the pass's first key, cuts every open connection and refuses every new one, so nothing
 * gets out whatever a page tries, and no list of browser features has to be complete. It's shut
 * once, for good: a page has no way to reach this code, and nothing here can open it again.
 */
import dgram from "node:dgram";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import net, { type AddressInfo, type Socket } from "node:net";

/** Headers meant for the proxy itself, and not for the website. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "proxy-authorization"]);

/** How long a check of the shut gate waits for it to hang up. */
const REFUSAL_LIMIT_MS = 2_000;

/** A client this proxy serves: the browser on this computer, and nothing else. */
export function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export interface FormGate {
  /** The port it listens on, on 127.0.0.1. */
  readonly port: number;
  /** Refuse everything from now on, and cut what's open. There's no opening it again. */
  shut(): void;
  /** Whether it's carried a request for this host name: that the browser really goes through it. */
  hasServed(hostname: string): boolean;
  /** Whether a new connection, tried now, is hung up on with no answer. */
  refuses(): Promise<boolean>;
  /** Shut it, and stop listening. Only once the browser has gone. */
  close(): Promise<void>;
}

/** A UDP socket of voicecap's, on this computer, that counts what it's sent and answers nothing. */
export interface UdpListener {
  readonly address: string;
  readonly port: number;
  heard(): number;
  close(): Promise<void>;
}

/**
 * Listens on 127.0.0.1, always, and never on another address of this computer. A bind on a real
 * interface can raise a Windows Firewall dialog that takes the screen mid-run, or the firewall can
 * drop the datagram so the check passes falsely. A browser with UDP open sends to loopback as well.
 */
export async function listenForUdp(): Promise<UdpListener> {
  const address = "127.0.0.1";
  const socket = dgram.createSocket("udp4");
  let heard = 0;
  socket.on("message", () => (heard += 1));
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, address, resolve);
  });
  socket.unref();
  return {
    address,
    port: socket.address().port,
    heard: () => heard,
    close: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}

/** A gate, open, on a free port of 127.0.0.1. */
export async function openFormGate(): Promise<FormGate> {
  let shut = false;
  const open = new Set<Socket>();
  const served = new Set<string>();
  const track = (socket: Socket) => {
    open.add(socket);
    socket.once("close", () => open.delete(socket));
    socket.on("error", () => {});
    if (shut) socket.destroy();
  };

  const server = createServer((request, response) => {
    const target = plainTarget(request);
    if (!target) {
      response.writeHead(400).end();
      return;
    }
    served.add(target.hostname);
    const headers = Object.fromEntries(
      Object.entries(request.headers).filter(([name]) => !HOP_BY_HOP.has(name)),
    );
    const upstream = httpRequest(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port || 80,
        path: target.pathname + target.search,
        method: request.method,
        headers,
        agent: false,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
        answer.pipe(response);
      },
    );
    upstream.on("socket", track);
    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  });

  server.on("connection", (socket) => {
    if (!isLoopback(socket.remoteAddress)) socket.destroy();
    else track(socket);
  });

  server.on("connect", (request, client, head) => {
    const target = tunnelTarget(request);
    if (!target) {
      client.destroy();
      return;
    }
    served.add(target.hostname);
    const upstream = net.connect(target.port, target.hostname.replace(/^\[|\]$/g, ""));
    track(upstream);
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    // An open gate answers, even to say no: only a shut one hangs up with no word.
    upstream.once("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    upstream.once("close", () => client.destroy());
    client.once("close", () => upstream.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  // A gate left behind by a run that failed mustn't keep voicecap from exiting.
  server.unref();
  const { port } = server.address() as AddressInfo;

  const shutGate = () => {
    shut = true;
    for (const socket of open) socket.destroy();
  };

  return {
    port,
    shut: shutGate,
    hasServed: (hostname) => served.has(hostname),
    refuses: () => refusedAt(port),
    close: () => {
      shutGate();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Where a proxied plain-HTTP request is going, or null if it doesn't say. */
function plainTarget(request: IncomingMessage): URL | null {
  try {
    const url = new URL(request.url ?? "");
    return url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Where a tunnel is going, or null if it doesn't say. */
export function tunnelTarget(request: { url?: string }): { hostname: string; port: number } | null {
  // Not a URL: that would drop port 80 as http's own, and a ws:// socket's tunnel with it.
  const address = request.url ?? "";
  const colon = address.lastIndexOf(":");
  const port = Number(address.slice(colon + 1));
  if (colon < 1 || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { hostname: address.slice(0, colon), port };
}

/** Asks the gate for a tunnel. A word back of any kind means it isn't shut. */
function refusedAt(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const finish = (refused: boolean) => {
      clearTimeout(limit);
      socket.destroy();
      resolve(refused);
    };
    const limit = setTimeout(() => finish(false), REFUSAL_LIMIT_MS);
    socket.once("connect", () => socket.write("CONNECT 127.0.0.1:9 HTTP/1.1\r\n\r\n"));
    socket.once("data", () => finish(false));
    socket.once("close", () => finish(true));
    socket.on("error", () => {});
  });
}
