# The whole game in one image: the built browser game, the API and the game
# server (Colyseus) on one port. PostgreSQL and LiveKit run beside it, see
# deploy/docker-compose.yml.

# ---- build the browser game ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci --include=dev
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY assets/converted assets/converted
RUN npm run build -w @nongs/client

# ---- run it ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# The server runs its TypeScript through tsx, so only the runtime packages are needed.
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY --from=build /app/apps/client/dist apps/client/dist
RUN rm -rf apps/server/data && mkdir -p apps/server/data && chown -R node:node apps/server/data
USER node
WORKDIR /app/apps/server
EXPOSE 5181
ENV PORT=5181 CLIENT_DIST=/app/apps/client/dist
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/main.ts"]
