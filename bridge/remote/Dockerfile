FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY dist/bridge/remote/server.mjs /app/server.mjs
COPY bridge/remote/migrations /app/migrations

RUN chown -R node:node /app
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "/app/server.mjs"]
