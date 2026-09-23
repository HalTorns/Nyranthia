# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY public ./public
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    NYRANTHIA_HOST=0.0.0.0 \
    NYRANTHIA_PORT=4317 \
    NYRANTHIA_DATA_DIR=/app/data
WORKDIR /app
COPY --chown=node:node server.mjs store.mjs rich-format.mjs config.mjs seed.json ./
COPY --from=build --chown=node:node /build/public/index.html /build/public/styles.css /build/public/favicon.svg /build/public/editor.bundle.js ./public/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
