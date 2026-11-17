# Build with Buildx --platform linux/arm64; both stages run on the target Debian architecture.
FROM node:26.13.1-bookworm-slim AS builder
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY shared/package.json shared/package.json
COPY app/package.json app/package.json
COPY backend/prisma backend/prisma
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend
RUN npm run build -w @destrabe/shared \
    && npx prisma generate --schema=backend/prisma/schema.prisma \
    && npm run build -w @destrabe/backend

FROM node:26.13.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY shared/package.json shared/package.json
COPY app/package.json app/package.json
COPY backend/prisma backend/prisma
RUN npm ci --omit=dev --workspace=@destrabe/backend --workspace=@destrabe/shared \
    && npx prisma generate --schema=backend/prisma/schema.prisma
COPY --from=builder /srv/shared/dist shared/dist
COPY --from=builder /srv/backend/dist backend/dist
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@destrabe/backend"]
