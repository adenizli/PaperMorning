# PaperMorning server image: NestJS + headless Chromium for PDF rendering.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data \
    PORT=3000 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    XDG_CONFIG_HOME=/tmp/.config
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Chromium headless shell + required system libraries (Playwright-managed), and fonts with full
# Turkish/Unicode coverage. Fonts are installed from Debian packages, not vendored in the repo.
RUN npx playwright install --with-deps --only-shell chromium \
 && apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core fonts-noto-core \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
# Apply pending migrations explicitly, then start (schema sync is always off). Runs node directly
# (no npm), so the root filesystem can be mounted read-only; HOME/XDG point at the /tmp tmpfs.
CMD ["sh", "-c", "node node_modules/typeorm/cli.js migration:run -d dist/service/persistence/data-source.js && exec node dist/main.js"]
