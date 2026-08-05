FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm install

# Nur Shared + API – kein Next.js (schonender Live-Deploy auf kleinem VPS).
FROM node:20-alpine AS builder-api
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w @wog/shared
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build -w @wog/api

# Web separat – wird nur bei target=web gebaut, nie parallel zu api/worker erzwungen.
FROM builder-api AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build -w @wog/web

FROM node:20-alpine AS api
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=768
ENV NODE_ENV=production
# pdftotext für Proforma-WE (Unitec-PDFs sind komprimiert, Rohtext reicht nicht)
RUN apk add --no-cache poppler-utils
COPY --from=builder-api /app/package.json ./
COPY --from=builder-api /app/node_modules ./node_modules
COPY --from=builder-api /app/packages/shared ./packages/shared
COPY --from=builder-api /app/apps/api/dist ./apps/api/dist
COPY --from=builder-api /app/apps/api/package.json ./apps/api/
COPY --from=builder-api /app/apps/api/tsconfig.json ./apps/api/
COPY --from=builder-api /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder-api /app/apps/api/assets ./apps/api/assets
COPY --from=builder-api /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder-api /app/node_modules/@prisma ./node_modules/@prisma
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM node:20-alpine AS worker
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=768
ENV NODE_ENV=production
# pdftotext für Proforma-WE (Unitec-PDFs sind komprimiert, Rohtext reicht nicht)
RUN apk add --no-cache poppler-utils
COPY --from=builder-api /app/package.json ./
COPY --from=builder-api /app/node_modules ./node_modules
COPY --from=builder-api /app/packages/shared ./packages/shared
COPY --from=builder-api /app/apps/api/dist ./apps/api/dist
COPY --from=builder-api /app/apps/api/package.json ./apps/api/
COPY --from=builder-api /app/apps/api/tsconfig.json ./apps/api/
COPY --from=builder-api /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder-api /app/apps/api/assets ./apps/api/assets
COPY --from=builder-api /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder-api /app/node_modules/@prisma ./node_modules/@prisma
WORKDIR /app/apps/api
CMD ["node", "dist/worker.js"]

FROM node:20-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
