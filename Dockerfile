FROM oven/bun:1.3.8
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY scripts/provision-tenant.ts ./scripts/provision-tenant.ts
ENV HOST=0.0.0.0 PORT=4000
EXPOSE 4000
CMD ["sh", "-c", "bun run scripts/migrate.ts && exec bun run src/index.ts"]
