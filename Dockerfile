# ---------- етап 1: збірка (тут є dev-залежності: TypeScript, Vite, esbuild) ----------
FROM node:22-alpine AS build
WORKDIR /app

# спочатку лише package*.json: поки залежності ті самі, npm ci береться з кешу шару
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
# клієнт -> client/dist (Vite), сервер -> server/dist/index.js (esbuild, з кодом shared усередині)
RUN npm run build

# ---------- етап 2: запуск (лише зібране + production-залежності) ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# версія збірки - її показує /health
ARG APP_VERSION=dev
ARG GIT_SHA=dev
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA \
    PORT=3000 HOST=0.0.0.0 STATIC_DIR=../client/dist LOG_DIR=./logs

# не root: користувач node є в образі node:alpine
RUN mkdir -p server/logs && chown node:node server/logs
USER node
WORKDIR /app/server
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# саме node, а не npm start: тоді SIGTERM від docker stop отримує Node, а не npm
CMD ["node", "dist/index.js"]
