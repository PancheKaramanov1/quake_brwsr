# syntax=docker/dockerfile:1

FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server

RUN npm run build
RUN npm run server:build

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S game \
    && adduser -S game -G game

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

RUN find ./dist -name '*.map' -delete \
    && chown -R game:game /app

USER game

CMD ["node", "dist-server/index.js"]
