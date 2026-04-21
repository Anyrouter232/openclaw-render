# OpenClaw — Project Context & Full Workflow

This is the complete, hand-off-ready reference for operating OpenClaw in its current deployed state. A new AI agent or developer should be able to read this file and immediately understand the entire stack, how to redeploy, how to debug, and why each decision was made.

---

## 1. What OpenClaw Is

OpenClaw is an npm CLI that runs a WebSocket-based "gateway" service. Clients (the user's Mac, or any other paired device) connect to the gateway over `wss://` with a device token, then make LLM calls that the gateway proxies to a configured model provider (here: `anyrouter.top`, a third-party Claude-compatible proxy).

The gateway supports 5 plugins: `acpx`, `browser`, `device-pair`, `phone-control`, `talk-voice`. It exposes:

- An HTTP control/health surface (`/health`, `/__openclaw__/canvas/`, etc.)
- A WebSocket endpoint for CLI commands (`openclaw agent`, `openclaw chat`, etc.)

OpenClaw is NOT Claude itself. It's a gateway + tooling layer in front of an Anthropic-compatible API.

---

## 2. Why Azure, Not Render

Originally deployed on Render free tier at `openclaw-render-qyzu.onrender.com`. Render's edge proxy does not reliably forward WebSocket `Upgrade` headers — every `openclaw gateway health` call returned `1006 abnormal closure (no close frame)`. Plain HTTP (`/health`) worked, but WebSocket didn't. This is a Render platform limitation on the free tier (paid plans have proper WS).

Migrated to **Azure Container Apps** on 2026-04-21/22. Azure has native WebSocket support and the whole gateway works end-to-end.

Render service is now **suspended**. UptimeRobot monitor pointing at the Render URL should also be stopped.

---

## 3. Live Endpoints & Secrets

| Item | Value |
|---|---|
| **Public URL** | `https://openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io` |
| **WebSocket URL** | `wss://openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io` |
| **Health check** | `curl https://openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io/health` |
| **Debug endpoint** | `curl https://openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io/__debug` |
| **Recent boot logs** | `curl https://openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io/__logs` |
| **Control UI (Web)** | `https://openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io/__openclaw__/canvas/` |
| **Gateway token** | *(see private notes — rotated when repo went public; 48-char random prefixed `openclaw_`)* |
| **anyrouter API key** | *(see private notes — `sk-*` prefix, stored in `config/openclaw.json` at build time)* |
| **anyrouter base URL** | `https://anyrouter.top` |
| **Active model on anyrouter** | `claude-opus-4-7` (claude-opus-4-6 was deprecated 2026-04-18) |

Gateway token was rotated from the old Render-era `openclaw-render-zahir-2026` when the repo was made public (secret scanning auto-revokes anything embedded in public git history).

---

## 4. Azure Resources

All in resource group **`openclaw-rg`**, region **Southeast Asia**, subscription **"Azure for Students"** (`cf127d1a-e735-4a13-a1e1-97f72ec7d789`), AIUB tenant, signed in as `25-61253-1@student.aiub.edu`.

### 4.1 Container App: `openclaw`
- **Image:** `openclawbd.azurecr.io/openclaw:v3` (bump tag per release: v1, v2, v3…)
- **Workload profile:** Consumption
- **Resources:** 0.5 vCPU, 1 GB memory, 2 GB ephemeral storage
- **Scale:** min=1, max=1 (pinned always-warm; see Cost section)
- **Ingress:** external, target port 8080, transport **http** (NOT `Auto` — Auto fumbles WS upgrade)
- **FQDN:** `openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io`
- **Container Environment:** `openclaw-env`
- **Registry wiring:** ACR admin creds injected as secret `openclawbdazurecrio-openclawbd`

### 4.2 Azure Container Registry: `openclawbd`
- **Login server:** `openclawbd.azurecr.io`
- **Tier:** Basic
- **Admin user:** ENABLED (required, Container App pulls with admin creds)
- **Image repo:** `openclaw` (tags: v1, v2, v3, …)

### 4.3 Managed identity + federated credential (LEGACY)
There's an orphan app registration / service principal (client id `6895d252-ab0f-409b-8720-21021baff5db`) from the original Azure portal CD wizard attempt that trusted `Anyrouter232/openclaw-render`. It's **unused** (we deploy manually now) but hard to delete because the AIUB tenant blocks student SP edits. Ignore it unless cleaning up the tenant.

---

## 5. Repository

- **GitHub:** https://github.com/mynameuwu9-del/openclaw-render
- **Visibility:** Public (required — `mynameuwu9-del` is on Pro plan with Actions quota, but we're not using CI/CD; public was chosen because Anyrouter232 repo was billing-locked)
- **Transfer history:** Originally `Anyrouter232/openclaw-render` (private, billing-locked for Actions) → transferred to `mynameuwu9-del/openclaw-render` on 2026-04-21 → made public shortly after
- **Access token (mynameuwu9-del PAT):** *(see private notes — classic PAT with full scope)*
- **Branch:** all work on `main`
- **Git LFS:** not used

### 5.1 Repo layout

```
openclaw-render/
├── Dockerfile                  # node:24-bookworm, installs openclaw@2026.4.15
├── boot.mjs                    # HTTP+WS proxy (8080 public → 18789 internal openclaw)
├── start.sh                    # CMD entrypoint; runs boot.mjs
├── config/
│   └── openclaw.json           # gateway + provider (anyrouter) config, baked into image
├── render.yaml                 # LEGACY Render blueprint, no longer used
└── README.md
```

### 5.2 Dockerfile env vars (all hardcoded, no Azure secrets needed at runtime)

```dockerfile
ENV NODE_ENV=production
ENV OPENCLAW_GATEWAY_PORT=8080
ENV OPENCLAW_STATE_DIR=/data/.openclaw
ENV OPENCLAW_WORKSPACE_DIR=/data/workspace
ENV OPENCLAW_GATEWAY_TOKEN=<48-char-random-gateway-token>    # see actual value in config
```

### 5.3 boot.mjs architecture

`boot.mjs` is the Docker CMD target. It does two jobs:

1. **Spawn `openclaw gateway run --bind lan --port 18789 --auth token --token <tok> --allow-unconfigured`** as a child process. openclaw internally listens on `0.0.0.0:18789`.
2. **Run a Node http.createServer on port 8080** that:
   - Serves `/health`, `/__debug`, `/__logs` locally (no upstream needed)
   - Returns 503 `{"status":"booting"}` while openclaw's internal port 18789 is still starting
   - Proxies all other HTTP to `127.0.0.1:18789`
   - Proxies WebSocket upgrades via `server.on('upgrade', ...)` to `127.0.0.1:18789`

Critical note: the original boot.mjs did **raw TCP pass-through** (`net.createServer` + `pipe`). That worked on Render but broke on Azure because Azure's HTTP ingress inspects traffic and gets confused by raw-TCP framing during the upgrade handshake. The current boot.mjs uses proper HTTP-aware proxying (`http.createServer` + `server.on('upgrade')`), which is what makes WebSockets actually work on Azure.

### 5.4 config/openclaw.json (the anyrouter provider config)

```json
{
  "env": { "shellEnv": { "enabled": false } },
  "gateway": {
    "controlUi": { "dangerouslyAllowHostHeaderOriginFallback": true }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "anyrouter": {
        "baseUrl": "https://anyrouter.top",
        "apiKey": "<anyrouter-api-key>",
        "api": "anthropic-messages",
        "models": [
          {
            "id": "claude-opus-4-7",
            "name": "Claude Opus 4.7",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "workspace": "/data/workspace",
      "model": { "primary": "anyrouter/claude-opus-4-7" }
    }
  }
}
```

---

## 6. Deploy Workflow (Rebuild + Redeploy)

There is **no CI/CD** for openclaw. Every deploy is manual via **GitHub Codespaces** (because local Docker on the user's Mac is broken due to Intel Homebrew running under Rosetta, and Azure Cloud Shell has no Docker daemon).

### 6.1 One-time Codespace setup (do once per codespace)

1. Open https://github.com/mynameuwu9-del/openclaw-render
2. Click **Code** (green) → **Codespaces** tab → **Create codespace on main**
3. Wait ~30s for VS Code in browser to load
4. In the Codespace terminal:

```bash
# Install az CLI (not preinstalled)
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Sign in (device-code flow, opens URL; paste code, log in as student email)
az login --use-device-code

# Log docker into ACR
az acr login --name openclawbd
```

### 6.2 Actual deploy (every time you change code)

```bash
cd /workspaces/openclaw-render
git pull   # pull latest

# Pick the next tag (v4, v5, etc.)
docker build -t openclawbd.azurecr.io/openclaw:vN -f Dockerfile .
docker push openclawbd.azurecr.io/openclaw:vN
az containerapp update \
  --name openclaw \
  --resource-group openclaw-rg \
  --image openclawbd.azurecr.io/openclaw:vN
```

Container App takes ~30s to provision a new revision. Inside the container, openclaw takes ~60-90s to fully boot (npm dep resolution + plugin load). Total cold cycle = ~2 minutes.

### 6.3 Build/push/deploy goes stuck? Check...

| Symptom | Fix |
|---|---|
| `UNAUTHORIZED: authentication required` on `az containerapp update` | ACR admin creds not wired. Run section 7 commands. |
| Revision `Failed to provision` with image-pull error | Container App doesn't have registry creds. Re-run section 7. |
| All HTTP requests return 503 `{"status":"booting"}` | Openclaw backend not yet listening on 18789. Wait 60-90s. |
| `/health` returns 200 but WS returns 1006 | `boot.mjs` doing raw TCP pass-through — need HTTP-aware proxy. |
| WS returns `1008: pairing required` | Device not paired (see section 8). |
| LLM call returns `provider rejected the request schema` | Model ID is deprecated on anyrouter. Update `config/openclaw.json`. |

---

## 7. Ingress & Registry Wiring (One-Time Setup, Already Done)

These were already applied but document them so a future agent can re-apply if the Container App is recreated.

```bash
# Enable ACR admin user
az acr update --name openclawbd --admin-enabled true

# Fetch ACR admin password
ACR_PASS=$(az acr credential show --name openclawbd --query "passwords[0].value" -o tsv)

# Wire ACR creds into the Container App (creates secret 'openclawbdazurecrio-openclawbd')
az containerapp registry set \
  --name openclaw \
  --resource-group openclaw-rg \
  --server openclawbd.azurecr.io \
  --username openclawbd \
  --password "$ACR_PASS"

# Set ingress: target port 8080, explicit http transport (Auto fumbles WS upgrade)
az containerapp ingress update \
  --name openclaw \
  --resource-group openclaw-rg \
  --target-port 8080 \
  --transport http
```

---

## 8. Device Pairing

OpenClaw gateway requires devices to be paired before they can issue commands. The gateway owner (whoever controls the container) approves pair requests.

### 8.1 Pair a new device (flow)

From the new device (e.g., fresh Mac):

```bash
openclaw gateway health \
  --url wss://openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io \
  --token <gateway-token>   # 48-char random, see private notes
```

This fails with `1008: pairing required` — but that's what creates a pending pairing request on the gateway.

Then from inside the container (via `az containerapp exec`), list and approve:

```bash
# List pending
az containerapp exec \
  --name openclaw --resource-group openclaw-rg \
  --command "openclaw devices list"
# Copy the Request UUID

# Approve
az containerapp exec \
  --name openclaw --resource-group openclaw-rg \
  --command "openclaw devices approve <request-uuid>"
```

Retry the `openclaw gateway health` call — now returns `OK (0ms)`.

### 8.2 Already-paired devices

- Mac (user's primary): fingerprint `f1f7bc96c9c67b49f7638cf186800dafe32e35070271ab01b64c24cae0da03d0`, role `operator`, approved 2026-04-22.

### 8.3 Revoke / rotate

```bash
openclaw devices list           # see tokens + fingerprints
openclaw devices revoke <role>  # kill a specific role's token
openclaw devices rotate <role>  # rotate a token
openclaw devices remove <fp>    # drop a paired device
openclaw devices clear          # nuke all paired devices (keeps gateway running)
```

These must be run inside the gateway container (via `az containerapp exec`) if the operator device is the one being revoked, otherwise you brick yourself.

---

## 9. Local Mac Configuration

Config lives at `~/.openclaw/openclaw.json` on the user's Mac. `openclaw configure` is the interactive way to set it. Key fields the Mac config needs:

```json
{
  "gateway": {
    "mode": "remote",
    "url": "wss://openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io",
    "auth": { "type": "token", "token": "<gateway-token>" }
  }
}
```

(The exact JSON shape depends on openclaw's internal schema — use `openclaw configure` rather than hand-editing unless you know the schema.)

With the config set, **all subcommands except `gateway *`** (which accepts `--url`/`--token`) auto-use the saved gateway. You just run:

```bash
openclaw agent --to +15555550000 -m "explain quicksort"
# --to <E.164> is a required session identifier. Use the same number for follow-up messages in a session.
```

---

## 10. Chatting with OpenClaw

### 10.1 Command line (one-shot)

```bash
openclaw agent --to +15555550000 -m "your message here"
```

The `--to` flag is a session key derived from an E.164 number. It does NOT actually call anyone. Same number = same session (context persists).

### 10.2 Web UI (proper chat)

Open in a browser, no CLI needed:

```
https://openclaw.delightfulsmoke-17bdd992.southeastasia.azurecontainerapps.io/__openclaw__/canvas/?token=<gateway-token>
```

(If visiting without the token query param returns `{"error":"Unauthorized"}`, append the token as shown.)

### 10.3 `openclaw dashboard` is broken for remote

`openclaw dashboard` always spins up a LOCAL gateway at `127.0.0.1:18789` regardless of your remote config. Known openclaw CLI limitation. Use the Azure canvas URL directly (section 10.2).

---

## 11. Anyrouter Session Refresh (Critical)

OpenClaw on Azure makes API calls to `anyrouter.top` using the API key in `config/openclaw.json`. Anyrouter's API auth is tied to the account's **browser session cookie** — the token stops working when the browser session expires (~every 24h).

### 11.1 Mac-side launchd agent

The user's Mac has a launchd plist at:

```
~/Library/LaunchAgents/com.zahir.anyrouter-refresh.plist
```

That runs every 25h:
```
open -a "Google Chrome" https://anyrouter.top/console
```

Chrome is already logged into anyrouter, so this refreshes the session cookie, which keeps the API token valid, which keeps openclaw-on-Azure working.

### 11.2 If openclaw starts getting 401s from anyrouter

- Check `launchctl list | grep anyrouter-refresh` on the Mac
- Or manually: open `https://anyrouter.top/console` in Chrome on the Mac
- If Chrome is logged out, log back in → cookie refreshes → openclaw on Azure starts working again

### 11.3 Model deprecation history

- `claude-opus-4-6`: DEPRECATED 2026-04-18. Calls return `400 "claude-opus-4-6 已下线，请切换到 claude-opus-4-7"` (offline, switch to 4-7).
- `claude-opus-4-7`: current active model. Use this in `config/openclaw.json`.
- CLI tools that set `ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-7[1m]` want the 1M-context variant (bracket syntax). That env-var syntax is for Claude Code CLI, not openclaw. openclaw config uses plain `claude-opus-4-7`.

---

## 12. Cost

| Item | Monthly | Notes |
|---|---|---|
| ACR Basic tier | ~$5 | Fixed, unavoidable while ACR exists |
| Container App (min=1, always-warm, 0.5 vCPU / 1 GB) | ~$30 | Most of the cost is vCPU-seconds |
| Log Analytics workspace | ~$0 | Free tier handles low volume |
| **Total** | **~$35/month** | $100 student credit → ~3 months runway |

### 12.1 Cost optimization option

Drop to scale-to-zero:

```bash
az containerapp update --name openclaw --resource-group openclaw-rg \
  --min-replicas 0 --max-replicas 1
```

- Drops to ~$5/month (just ACR) → $100 credit lasts ~20 months.
- Trade-off: first request after ~5 min idle cold-starts (container spins up + openclaw boots = 60-90s). Your CLI will timeout the first time; retry after 90s and it works.
- Not recommended for this setup because the user's chat sessions should feel instant.

### 12.2 If student credit runs out

- Azure stops the Container App when the $100 subscription expires.
- Options: upgrade to pay-as-you-go, migrate to another host (Fly.io has good WS support on free tier), or rebuild on a free alternative.

---

## 13. History of Failed Approaches (So Future Agents Don't Re-try)

Every attempted CI/CD / automation path that was tried and failed:

1. **GitHub Actions on `Anyrouter232/openclaw-render` (private)** — account is billing-locked. Even making the repo public doesn't unlock Actions at the account level. Every run: `startup_failure`.
2. **Azure Container Registry Tasks** — blocked on Azure for Students: `TasksOperationsNotAllowed`. Same for `az acr build` (uses Tasks).
3. **Creating a service principal via `az ad sp create-for-rbac`** — AIUB tenant admin policy blocks student app-registration creation: `Insufficient privileges to complete the operation`.
4. **Container App "Continuous Deployment" wizard (portal)** — Image dropdown is unclickable because ACR starts empty (chicken-and-egg: wizard needs existing image to select). Also tried User-assigned Identity flow.
5. **Local Docker on Mac via Colima** — Homebrew on the user's Mac is Intel-x86 running under Rosetta on Apple Silicon. `colima start` fails with `limactl is running under rosetta`. Would need native ARM Homebrew or Docker Desktop.
6. **Azure Cloud Shell** — no longer has a Docker daemon (removed years ago). `docker build` fails with `Cannot connect to the Docker daemon`.

**Only working path: GitHub Codespaces** (section 6). Free Docker daemon, browser terminal, inherits `az login` via `--use-device-code`. Not automated but reliable.

---

## 14. Anti-Checklist (Known Gotchas)

- Do NOT set ingress `transport: Auto` — Azure fumbles the WS upgrade. Use `http`.
- Do NOT try raw TCP pass-through in `boot.mjs` — breaks WS upgrade on Azure. Use HTTP-aware proxy with `server.on('upgrade', ...)`.
- Do NOT embed the GH PAT in any file that will end up in a public commit — GitHub secret scanning auto-revokes it.
- Do NOT use `claude-opus-4-6` as the anyrouter model ID — deprecated.
- Do NOT run `openclaw devices approve` multiple times with the same request ID — subsequent calls error with `unknown requestId`.
- Do NOT hit `az containerapp exec` too frequently — gets rate-limited with `429 Too Many Requests` (retry-after: 600s).
- Do NOT forget that `openclaw dashboard` ignores remote config — always runs a local instance. Use the canvas URL directly for the web UI.
- Do NOT try to use ACR Tasks or `az ad sp create-for-rbac` on this student subscription — blocked.

---

## 15. Quick Troubleshooting Flow

1. **`/health` returns anything but `{"ok":true,...}`** → container crashed. Check `az containerapp logs show --name openclaw --resource-group openclaw-rg --tail 200`.
2. **`/health` returns `"status":"booting"` forever** → openclaw's internal 18789 isn't coming up. Check container logs for crashes during `[gateway] starting HTTP server` phase.
3. **WS timeout after 10s** → container cold-started, client gave up. If min=0, first request triggers cold start; wait 90s and retry.
4. **WS closes with 1008 `pairing required`** → not paired. See section 8.
5. **Agent call returns `provider rejected the request schema`** → model deprecated or apiKey invalid. Check `config/openclaw.json` model ID; check anyrouter login status on Mac.
6. **Agent call returns 401 from anyrouter** → Mac's anyrouter session cookie expired. Open `https://anyrouter.top/console` in Chrome on the Mac to refresh.

---

## 16. Future Improvements (Not Done Yet)

- **CI/CD** — wait for GitHub billing unlock on `Anyrouter232` (or fully migrate off that account), then wire GH Actions in `mynameuwu9-del/openclaw-render`. Would use user-assigned managed identity on the Container App + `azure/login@v2` OIDC.
- **Custom domain + TLS** — attach a vanity domain via Azure Container Apps custom domain feature. `https://openclaw.yourdomain.com`.
- **Azure Files volume for `/data`** — currently `/data` is ephemeral per replica. Gateway state (paired devices, workspace) wipes on revision changes. For now, pairing happens once and gets re-established after any revision change.
- **Multi-tenant openclaw** — separate gateway per user/team with isolated workspaces.
- **Monitoring / alerts** — hook Container App's Log Analytics to email alerts when `runningStatus != Running`.

---

## 17. TL;DR for a New AI Agent

> You maintain a WebSocket gateway called OpenClaw. It's hosted on Azure Container Apps in Southeast Asia, region-pinned, always-warm (min=1). Image lives in Azure Container Registry at `openclawbd.azurecr.io/openclaw:vN`. Repo is `github.com/mynameuwu9-del/openclaw-render` (public). To redeploy, open a Codespace on that repo and run the 5 commands in section 6.2. The gateway token and anyrouter API key are in the operator's private notes (never embed in this repo — secret scanning will block the commit). The primary user's Mac is already paired. Model calls go through `anyrouter.top` with model `claude-opus-4-7`. If WS breaks, check `boot.mjs`'s upgrade handler and the ingress transport (must be `http`). Cost is ~$35/mo against a $100 student credit. Never add raw TCP pass-through in boot.mjs, never set transport=Auto, never embed secrets in public commits, never use ACR Tasks or create service principals (tenant blocks both).
