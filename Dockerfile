# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

# Next.js's standalone output tracer doesn't follow the generated Prisma
# client into pnpm's nested store layout, so `.prisma/client` (the WASM
# query compiler + generated types) is missing from .next/standalone
# unless copied in manually here, next to where @prisma/client itself
# already landed in the traced output.
RUN SRC=$(find node_modules/.pnpm -maxdepth 3 -type d -path '*/@prisma+client@*/node_modules/.prisma') && \
    DEST_PARENT=$(find .next/standalone/node_modules/.pnpm -maxdepth 3 -type d -path '*/@prisma+client@*/node_modules') && \
    cp -r "$SRC" "$DEST_PARENT/.prisma"

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
