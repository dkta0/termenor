FROM oven/bun:1.3.10-alpine
WORKDIR /app

# install workspace deps
COPY package.json bun.lock ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN bun install --frozen-lockfile --production

# source (server + protocol only; client runs in the player's terminal)
COPY packages/protocol ./packages/protocol
COPY packages/server ./packages/server

ENV PORT=3000
ENV DB_PATH=/app/data/termenor.db
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["bun", "run", "packages/server/src/index.ts"]
