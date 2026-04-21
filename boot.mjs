import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const publicPort = Number(process.env.PORT || process.env.OPENCLAW_GATEWAY_PORT || 8080);
const internalPort = Number(process.env.OPENCLAW_INTERNAL_PORT || 18789);
const host = "127.0.0.1";
const bootVersion = "2026-04-21.5";

let backendReady = false;
const recentLogs = [];

function rememberLog(source, chunk) {
  const lines = chunk
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[${source}] ${line}`);
  recentLogs.push(...lines);
  while (recentLogs.length > 80) recentLogs.shift();
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
    process.env.OPENCLAW_GATEWAY_TOKEN || "openclaw-render-zahir-2026",
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

function proxyHeaders(req) {
  const headers = { ...req.headers };
  for (const key of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    delete headers[key];
  }
  headers.host = `${host}:${internalPort}`;
  headers["x-forwarded-host"] = req.headers.host || "";
  headers["x-forwarded-proto"] = "https";
  return headers;
}

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

  if (req.url === "/__logs") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(recentLogs.join("\n") + "\n");
    return;
  }

  const proxyReq = http.request(
    {
      host,
      port: internalPort,
      method: req.method,
      path: req.url,
      headers: proxyHeaders(req),
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.setTimeout(30000, () => {
    proxyReq.destroy(new Error("backend timeout"));
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(504, { "content-type": "text/plain; charset=utf-8", "retry-after": "10" });
    }
    res.end("OpenClaw backend timed out. Refresh in a few seconds.\n");
  });

  if (req.method === "GET" || req.method === "HEAD") {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
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
