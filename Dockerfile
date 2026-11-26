# syntax=docker/dockerfile:1
# The video editor we host: OpenCut classic (classic/), the version with a working editor.
# The rewrite in apps/ is not part of this image. See README.md, "Hosting the editor".
#
# It is classic/apps/web/Dockerfile with the paths of this repository, the server-copy volume
# and an entrypoint that makes that volume writable. The image runs alone: classic's database
# and Redis only serve sign-in, feedback and the sound search, none of which this host uses.

FROM oven/bun:alpine AS base

FROM base AS builder
WORKDIR /app

COPY classic/package.json package.json
COPY classic/bun.lock bun.lock
COPY classic/turbo.json turbo.json
COPY classic/apps/web/package.json apps/web/package.json
RUN bun install

COPY classic/apps/web/ apps/web/

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The build only checks that these are set (classic/apps/web/src/env/web.ts); none is contacted.
ENV DATABASE_URL="postgresql://opencut:unused@127.0.0.1:5432/opencut"
ENV BETTER_AUTH_SECRET="unused-without-a-database"
ENV UPSTASH_REDIS_REST_URL="http://127.0.0.1:8079"
ENV UPSTASH_REDIS_REST_TOKEN="unused"
ENV NEXT_PUBLIC_SITE_URL="http://localhost:3000"
ENV NEXT_PUBLIC_MARBLE_API_URL="https://api.marblecms.com"
ENV MARBLE_WORKSPACE_KEY="build-placeholder"
ENV FREESOUND_CLIENT_ID="unset"
ENV FREESOUND_API_KEY="unset"

WORKDIR /app/apps/web
RUN bun run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache su-exec \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY classic/apps/web/docker-entrypoint.sh /usr/local/bin/opencut-web

RUN chown nextjs:nodejs apps

# The server checks these when it starts, as the build does; set real ones to use those features.
ENV DATABASE_URL="postgresql://opencut:unused@127.0.0.1:5432/opencut"
ENV BETTER_AUTH_SECRET="unused-without-a-database"
ENV UPSTASH_REDIS_REST_URL="http://127.0.0.1:8079"
ENV UPSTASH_REDIS_REST_TOKEN="unused"
ENV NEXT_PUBLIC_MARBLE_API_URL="https://api.marblecms.com"
ENV MARBLE_WORKSPACE_KEY="placeholder"
ENV FREESOUND_CLIENT_ID="unset"
ENV FREESOUND_API_KEY="unset"

# Where files, projects and exports are kept when OPENCUT_UPLOAD_SECRET is set; mount a volume here.
ENV OPENCUT_UPLOAD_DIR=/mnt/sdc1/Rinku/OpenCut
RUN mkdir -p /mnt/sdc1/Rinku/OpenCut/.incoming && chown -R nextjs:nodejs /mnt/sdc1/Rinku/OpenCut
VOLUME /mnt/sdc1/Rinku/OpenCut

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# It starts as root only to hand a host-mounted volume to the server, which runs as nextjs;
# `--user nextjs` still works when the volume is already theirs.
ENTRYPOINT ["opencut-web"]
CMD ["bun", "apps/web/server.js"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
