import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const publicPort = Number(process.env.PORT || process.env.OPENCLAW_GATEWAY_PORT || 8080);
const internalPort = Number(process.env.OPENCLAW_INTERNAL_PORT || 18789);
const host = "127.0.0.1";
const bootVersion = "2026-04-22.1";
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

const server = http.createServer((req, res) => {
  const urlPath = req.url || "/";

  if (urlPath === "/health" || urlPath === "/healthz") {
    const body = JSON.stringify({ ok: true, status: backendReady ? "live" : "booting", bootVersion });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  if (urlPath === "/__debug") {
    const body = JSON.stringify({
      ok: true,
      bootVersion,
      backendReady,
      publicPort,
      internalPort,
      hasGatewayToken: Boolean(token),
      recentLogs: recentLogs.slice(-40),
    });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  if (urlPath === "/__logs") {
    const body = `${recentLogs.join("\n")}\n`;
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  if (!backendReady) {
    const body = JSON.stringify({ ok: false, status: "booting", bootVersion });
    res.writeHead(503, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "retry-after": "5",
    });
    res.end(body);
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

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      const body = JSON.stringify({ ok: false, error: "backend_unavailable", message: err.message });
      res.writeHead(502, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    } else {
      res.destroy();
    }
  });

  req.pipe(proxyReq);
});

server.on("upgrade", (req, clientSocket, head) => {
  if (!backendReady) {
    clientSocket.write(
      "HTTP/1.1 503 Service Unavailable\r\n" +
        "content-type: application/json\r\n" +
        "connection: close\r\n" +
        "\r\n" +
        JSON.stringify({ ok: false, status: "booting", bootVersion }),
    );
    clientSocket.destroy();
    return;
  }

  const backendSocket = net.connect(internalPort, host);
  backendSocket.on("connect", () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) lines.push(`${key}: ${v}`);
      } else if (value !== undefined) {
        lines.push(`${key}: ${value}`);
      }
    }
    backendSocket.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) backendSocket.write(head);
    backendSocket.pipe(clientSocket);
    clientSocket.pipe(backendSocket);
  });

  backendSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => backendSocket.destroy());
});

server.on("clientError", (err, socket) => {
  socket.destroy();
});

server.listen(publicPort, "0.0.0.0", () => {
  console.log(
    `[boot] http+ws proxy listening on 0.0.0.0:${publicPort}; OpenClaw backend ${host}:${internalPort}`,
  );
});

function shutdown(signal) {
  console.log(`[boot] ${signal} received`);
  openclaw.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
