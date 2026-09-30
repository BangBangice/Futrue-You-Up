FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-slim
# The in-game terminal runs real git against the player's workspace.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scenarios ./scenarios
COPY workspace-template ./workspace-template
COPY docker-entrypoint.sh ./
# Player code runs in child processes, so the whole server runs unprivileged. The entrypoint starts as root only to
# hand a mounted volume at .data to the node user, then drops to it (docker-entrypoint.sh).
RUN mkdir .data && chown node:node .data
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--no-warnings", "--experimental-strip-types", "server/index.ts"]
