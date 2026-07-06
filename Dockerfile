# ── Builder stage ────────────────────────────────────────────────────────────
# Use Debian/glibc so Rollup's platform-specific native binary installs
# correctly. Alpine (musl libc) triggers an npm bug with optional deps:
# https://github.com/npm/cli/issues/4828
FROM node:20-slim AS builder

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
# Switch back to Alpine for a lean final image. Only production deps and the
# compiled build output are copied over — devDependencies are left behind.
FROM node:20-alpine AS production

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/build ./build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "run", "docker-start"]
