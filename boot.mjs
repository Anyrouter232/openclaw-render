import net from "node:net";
import { spawn } from "node:child_process";

const publicPort = Number(process.env.PORT || process.env.OPENCLAW_GATEWAY_PORT || 8080);
const internalPort = Number(process.env.OPENCLAW_INTERNAL_PORT || 18789);
const host = "127.0.0.1";
const bootVersion = "2026-04-21.6";
const token = process.env.OPENCLAW_GATEWAY_TOKEN || "openclaw-render-zahir-2026";
const recentLogs = [];
let backendReady = false;

function rememberLog(source, chunk) {
  const lines = chunk
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[${source}] ${line}`);
  recentLogs.push(...lines);
  while (recentLogs.length > 120) recentLogs.shift();
}

const openclaw = spawn(
  "openclaw",
  [
    "gateway",
    "run",
    "--bind",
    "lan",
    "--port",
    String(internalPort),
    "--auth",
    "token",
    "--token",
    token,
    "--allow-unconfigured",
  ],
  {
    env: {
      ...process.env,
      OPENCLAW_GATEWAY_PORT: String(internalPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

openclaw.stdout.on("data", (chunk) => {
  rememberLog("stdout", chunk);
  process.stdout.write(chunk);
});

openclaw.stderr.on("data", (chunk) => {
  rememberLog("stderr", chunk);
  process.stderr.write(chunk);
});

openclaw.on("exit", (code, signal) => {
  console.error(`[boot] openclaw exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  process.exit(code ?? 1);
});

function httpResponse(status, contentType, body) {
  return [
    `HTTP/1.1 ${status}`,
    `content-type: ${contentType}`,
    `content-length: ${Buffer.byteLength(body)}`,
    "connection: close",
    "",
    body,
  ].join("\r\n");
}

function canConnect() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: internalPort });
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function refreshBackendReady() {
  backendReady = await canConnect();
}

setInterval(refreshBackendReady, 3000).unref();
refreshBackendReady();

function getPath(buffer) {
  const firstLine = buffer.toString("latin1", 0, Math.min(buffer.length, 4096)).split("\r\n", 1)[0] || "";
  const parts = firstLine.split(" ");
  return parts.length >= 2 ? parts[1] : "";
}

function handleLocalRoute(path, client) {
  if (path === "/health" || path === "/healthz") {
    client.end(
      httpResponse(
        "200 OK",
        "application/json",
        JSON.stringify({ ok: true, status: backendReady ? "live" : "booting", bootVersion }),
      ),
    );
    return true;
  }

  if (path === "/__debug") {
    client.end(
      httpResponse(
        "200 OK",
        "application/json",
        JSON.stringify({
          ok: true,
          bootVersion,
          backendReady,
          publicPort,
          internalPort,
          hasGatewayToken: Boolean(token),
        }),
      ),
    );
    return true;
  }

  if (path === "/__logs") {
    client.end(httpResponse("200 OK", "text/plain; charset=utf-8", `${recentLogs.join("\n")}\n`));
    return true;
  }

  return false;
}

const server = net.createServer((client) => {
  let buffered = Buffer.alloc(0);
  let connected = false;

  client.setTimeout(60000);

  client.on("data", (chunk) => {
    if (connected) return;
    buffered = Buffer.concat([buffered, chunk]);
    if (!buffered.includes(Buffer.from("\r\n\r\n")) && buffered.length < 65536) return;

    const path = getPath(buffered);
    if (handleLocalRoute(path, client)) return;

    if (!backendReady) {
      client.end(httpResponse("503 Service Unavailable", "text/plain; charset=utf-8", "OpenClaw is starting. Refresh in a few seconds.\n"));
      return;
    }

    connected = true;
    const backend = net.connect({ host, port: internalPort }, () => {
      backend.write(buffered);
      client.pipe(backend);
      backend.pipe(client);
    });

    backend.on("error", () => {
      if (!client.destroyed) {
        client.end(httpResponse("502 Bad Gateway", "text/plain; charset=utf-8", "OpenClaw backend unavailable.\n"));
      }
    });
    backend.on("close", () => client.destroy());
    client.on("close", () => backend.destroy());
  });

  client.on("timeout", () => client.destroy());
});

server.listen(publicPort, "0.0.0.0", () => {
  console.log(`[boot] tcp pass-through listening on 0.0.0.0:${publicPort}; OpenClaw backend ${host}:${internalPort}`);
});

function shutdown(signal) {
  console.log(`[boot] ${signal} received`);
  openclaw.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
