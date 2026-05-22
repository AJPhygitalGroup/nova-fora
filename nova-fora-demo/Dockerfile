# syntax=docker/dockerfile:1.7
# Build the Vite SPA and serve the static files with nginx.
# Multi-stage keeps the final image tiny (~25 MB with nginx:alpine).

# ─────────────────────────────────────────────────────
# Stage 1: build
# ─────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Leverage Docker cache: install deps first, then copy source
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# VITE_API_BASE_URL must be present at BUILD TIME — Vite inlines import.meta.env.*
# Default points to the current production API host on EasyPanel; if you
# deploy this image to a different host, pass --build-arg VITE_API_BASE_URL=...
# to override. (The newer EasyPanel UI we're on doesn't expose a build-args
# panel separately, so the default carries the value used by every prod
# build — keep it pointed at the live API host.)
ARG VITE_API_BASE_URL=https://nova-fora-api.xzlnys.easypanel.host
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build


# ─────────────────────────────────────────────────────
# Stage 2: runtime — nginx:alpine
# ─────────────────────────────────────────────────────
FROM nginx:alpine

# Copy build output
COPY --from=builder /app/dist /usr/share/nginx/html

# Custom nginx config: SPA fallback + security headers + gzip
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# nginx:alpine's default CMD already runs nginx in the foreground — no CMD override needed.
