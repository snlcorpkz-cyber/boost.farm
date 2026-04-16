# Stage 1: Build everything
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
COPY apps/admin/ apps/admin/

RUN npm run build -w packages/game-engine && \
    npm run build -w packages/api && \
    npm run build -w apps/web && \
    npm run build -w apps/admin

# Stage 2: Frontend — nginx
FROM nginx:alpine AS frontend

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html/admin

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

# Stage 3: API server
FROM node:20-alpine AS api

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

RUN npm ci --ignore-scripts --omit=dev

COPY --from=builder /app/packages/game-engine/dist packages/game-engine/dist
COPY --from=builder /app/packages/game-engine/package.json packages/game-engine/
COPY --from=builder /app/packages/shared packages/shared
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/api/package.json packages/api/

EXPOSE 3001

CMD ["node", "--dns-result-order=ipv4first", "packages/api/dist/index.js"]
