import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const publicPort = Number(process.env.PORT || process.env.OPENCLAW_GATEWAY_PORT || 8080);
const internalPort = Number(process.env.OPENCLAW_INTERNAL_PORT || 18789);
const host = "127.0.0.1";
const bootVersion = "2026-04-21.2";

let backendReady = false;

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
    process.env.OPENCLAW_GATEWAY_TOKEN || "openclaw-render-zahir-2026",
    "--allow-unconfigured",
  ],
  {
    env: {
      ...process.env,
      OPENCLAW_GATEWAY_PORT: String(internalPort),
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);

openclaw.on("exit", (code, signal) => {
  console.error(`[boot] openclaw exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  process.exit(code ?? 1);
});

async function refreshBackendReady() {
  backendReady = await canConnect();
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

setInterval(refreshBackendReady, 3000).unref();
refreshBackendReady();

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, status: backendReady ? "live" : "booting", bootVersion }));
    return;
  }

  if (req.url === "/__debug") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        bootVersion,
        backendReady,
        publicPort,
        internalPort,
        hasGatewayToken: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN),
      }),
    );
    return;
  }

  const proxyReq = http.request(
    {
      host,
      port: internalPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", () => {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "10" });
    res.end("OpenClaw is starting. Refresh in a few seconds.\n");
  });

  req.pipe(proxyReq);
});

server.on("upgrade", (req, socket, head) => {
  const backend = net.connect(internalPort, host, () => {
    backend.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        Object.entries(req.headers)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\r\n") +
        "\r\n\r\n",
    );
    if (head.length > 0) backend.write(head);
    socket.pipe(backend);
    backend.pipe(socket);
  });

  backend.on("error", () => socket.destroy());
});

server.listen(publicPort, "0.0.0.0", () => {
  console.log(`[boot] listening on 0.0.0.0:${publicPort}; proxying OpenClaw on ${host}:${internalPort}`);
});

function shutdown(signal) {
  console.log(`[boot] ${signal} received`);
  openclaw.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
