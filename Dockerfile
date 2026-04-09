# ─────────────────────────────────────────────────────────
# Mission Control — Production Dockerfile
# Multi-stage build: install deps → build → slim runtime
# ─────────────────────────────────────────────────────────

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runtime
WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built output
COPY --from=builder /app/dist ./dist

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/setup/status || exit 1

# Run as non-root
RUN addgroup -S mcgroup && adduser -S mcuser -G mcgroup
USER mcuser

EXPOSE 5000
ENV NODE_ENV=production

CMD ["node", "dist/index.cjs"]
