# OpenClaw Render Deployment

Private Render deployment for OpenClaw with Anyrouter as the model provider.

## Render

Create a Render Blueprint from this repo. The service exposes `/health` for Render and Uptime Robot checks.

Required secret in Render:

- `ANTHROPIC_AUTH_TOKEN`

Free Render services can spin down and do not provide persistent disk. Upgrade the `plan` and add a disk in `render.yaml` if you need durable OpenClaw state.
