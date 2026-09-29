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
COPY workspace-template ./workspace-template
# Player code runs in child processes, so the whole server runs unprivileged.
RUN mkdir .data && chown node:node .data
USER node
CMD ["node", "--no-warnings", "--experimental-strip-types", "server/index.ts"]
