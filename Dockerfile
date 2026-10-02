# syntax=docker/dockerfile:1

# Build stage: Node 20 matches the GitHub Pages workflow and the dev container.
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage: nginx serving the single-file build (vite-plugin-singlefile
# inlines everything into dist/index.html).
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
