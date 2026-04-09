# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/

RUN npm run build -w packages/game-engine && \
    npm run build -w apps/web

# Stage 2: Serve with nginx
FROM nginx:alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
