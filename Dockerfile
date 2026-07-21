FROM node:20-slim
WORKDIR /app
# node:20-slim ships without openssl; Prisma needs it to pick the right query engine.
# Must come BEFORE pnpm install, since postinstall runs `prisma generate`.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
CMD ["node", "build"]