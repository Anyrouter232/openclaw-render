FROM node:24-bookworm

ENV NODE_ENV=production
ENV OPENCLAW_GATEWAY_PORT=8080
ENV OPENCLAW_STATE_DIR=/data/.openclaw
ENV OPENCLAW_WORKSPACE_DIR=/data/workspace
ENV OPENCLAW_GATEWAY_TOKEN=openclaw-render-zahir-2026

RUN npm install -g --omit=dev --no-audit --no-fund openclaw@2026.4.15

WORKDIR /app
COPY config/openclaw.json /app/openclaw.json
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8080 10000
HEALTHCHECK --interval=3m --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || process.env.OPENCLAW_GATEWAY_PORT || '10000') + '/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["/app/start.sh"]
