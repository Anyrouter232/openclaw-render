# OpenClaw Render Deployment

Private Render deployment for OpenClaw with Anyrouter as the model provider.

## Render

Create a Render Blueprint from this repo. The service exposes `/health` for Render and Uptime Robot checks.

Free Render services can spin down and do not provide persistent disk. Upgrade the `plan` and add a disk in `render.yaml` if you need durable OpenClaw state.

Gateway token:

- `openclaw-render-zahir-2026`

## Deploy steps

1. Open `https://render.com/deploy?repo=https://github.com/Anyrouter232/openclaw-render`.
2. Select the free plan when Render asks for confirmation.
3. Deploy the Blueprint.
4. After deploy, open `https://<service-name>.onrender.com/health` and confirm it returns healthy.

## Uptime Robot

Create an HTTPS monitor pointed at `https://<service-name>.onrender.com/health` with a 5-minute interval. This checks the OpenClaw service health endpoint only.
