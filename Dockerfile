# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json ./
COPY src/shared ./src/shared
COPY server ./server
RUN npm run server:build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S game && adduser -S game -G game
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist-server ./dist-server
RUN chown -R game:game /app
USER game
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist-server/index.js"]
