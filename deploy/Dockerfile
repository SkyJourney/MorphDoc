# syntax=docker/dockerfile:1

ARG RUNTIME_BASE_IMAGE=node:22-bookworm-slim

FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/docx-engine/package.json packages/docx-engine/package.json
COPY packages/docx-theme-engine/package.json packages/docx-theme-engine/package.json
COPY packages/document-visual-diff/package.json packages/document-visual-diff/package.json
COPY packages/font-pack-builder/package.json packages/font-pack-builder/package.json
COPY packages/font-pack-registry/package.json packages/font-pack-registry/package.json
COPY packages/markdown-echarts/package.json packages/markdown-echarts/package.json
COPY packages/preview-engine/package.json packages/preview-engine/package.json
COPY packages/renderer/package.json packages/renderer/package.json
COPY packages/semantic-document/package.json packages/semantic-document/package.json
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json product.json ./
COPY apps ./apps
COPY packages ./packages
COPY logos ./logos
COPY samples ./samples
RUN pnpm --filter @morphdoc/markdown-echarts run build \
    && pnpm --filter @morphdoc/core run build \
    && pnpm --filter @morphdoc/semantic-document run build \
    && pnpm --filter @morphdoc/docx-theme-engine run build \
    && pnpm --filter @morphdoc/font-pack-registry run build \
    && pnpm --filter @morphdoc/docx-engine run build \
    && pnpm --filter @morphdoc/renderer run build \
    && pnpm --filter @morphdoc/application run build \
    && pnpm --filter @morphdoc/preview-engine run build \
    && pnpm --filter @morphdoc/web run build \
    && pnpm --filter @morphdoc/server run build

FROM node:22-bookworm-slim AS production-dependencies

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/docx-engine/package.json packages/docx-engine/package.json
COPY packages/docx-theme-engine/package.json packages/docx-theme-engine/package.json
COPY packages/document-visual-diff/package.json packages/document-visual-diff/package.json
COPY packages/font-pack-builder/package.json packages/font-pack-builder/package.json
COPY packages/font-pack-registry/package.json packages/font-pack-registry/package.json
COPY packages/markdown-echarts/package.json packages/markdown-echarts/package.json
COPY packages/preview-engine/package.json packages/preview-engine/package.json
COPY packages/renderer/package.json packages/renderer/package.json
COPY packages/semantic-document/package.json packages/semantic-document/package.json
RUN pnpm install --frozen-lockfile --prod --filter @morphdoc/server...

FROM node:22-bookworm-slim AS pandoc-runtime

ARG PANDOC_VERSION=3.9.0.2
ARG PANDOC_LINUX_AMD64_URL=https://github.com/jgm/pandoc/releases/download/3.9.0.2/pandoc-3.9.0.2-linux-amd64.tar.gz
ARG PANDOC_LINUX_AMD64_SHA256=A69ABFABABDA8A56969A254B09F9553A7BE89DDEC00D4E0FE9FD585D71A67508
ARG PANDOC_COPYING_URL=https://raw.githubusercontent.com/jgm/pandoc/3.9.0.2/COPYING.md
ARG PANDOC_COPYING_SHA256=9D56CAC92294E206AF026A5502BEE0FED77200B08B51EC28AA63C9EFDA4DCFDD
ARG PANDOC_COPYRIGHT_URL=https://raw.githubusercontent.com/jgm/pandoc/3.9.0.2/COPYRIGHT
ARG PANDOC_COPYRIGHT_SHA256=842E33EF01625E93F85BEBB8BAC83AA570186B7AA77A09971257CC29F8F60740
RUN test "$(dpkg --print-architecture)" = "amd64" \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/var/cache/pandoc \
    set -eux; \
    archive="/var/cache/pandoc/pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz"; \
    if [ ! -f "${archive}" ]; then \
      curl --fail --location --retry 3 --silent --show-error \
        --output "${archive}" "${PANDOC_LINUX_AMD64_URL}"; \
    fi; \
    echo "${PANDOC_LINUX_AMD64_SHA256}  ${archive}" | sha256sum --check --strict; \
    mkdir -p "/opt/pandoc/${PANDOC_VERSION}"; \
    tar --extract --gzip --file "${archive}" \
      --directory "/opt/pandoc/${PANDOC_VERSION}" --strip-components=1; \
    curl --fail --location --retry 3 --silent --show-error \
      --output "/opt/pandoc/${PANDOC_VERSION}/COPYING.md" "${PANDOC_COPYING_URL}"; \
    echo "${PANDOC_COPYING_SHA256}  /opt/pandoc/${PANDOC_VERSION}/COPYING.md" \
      | sha256sum --check --strict; \
    curl --fail --location --retry 3 --silent --show-error \
      --output "/opt/pandoc/${PANDOC_VERSION}/COPYRIGHT" "${PANDOC_COPYRIGHT_URL}"; \
    echo "${PANDOC_COPYRIGHT_SHA256}  /opt/pandoc/${PANDOC_VERSION}/COPYRIGHT" \
      | sha256sum --check --strict; \
    test "$(/opt/pandoc/${PANDOC_VERSION}/bin/pandoc --version | head -n 1)" = "pandoc ${PANDOC_VERSION}"

FROM ${RUNTIME_BASE_IMAGE} AS runtime

USER root
ARG RUNTIME_BASE_IMAGE
ARG REUSE_PLAYWRIGHT_RUNTIME=0
RUN if [ "${REUSE_PLAYWRIGHT_RUNTIME}" = "1" ]; then \
      echo "Reusing the Playwright runtime from ${RUNTIME_BASE_IMAGE}"; \
    else \
      apt-get update \
      && apt-get install -y --no-install-recommends \
        nginx \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
      && rm -rf /var/lib/apt/lists/* \
      && groupadd --system pwuser \
      && useradd --system --create-home --gid pwuser --shell /bin/bash pwuser; \
    fi

COPY --from=pandoc-runtime /opt/pandoc/3.9.0.2 /opt/pandoc/3.9.0.2
RUN ln -sfn /opt/pandoc/3.9.0.2/bin/pandoc /usr/local/bin/pandoc \
    && test "$(pandoc --version | head -n 1)" = "pandoc 3.9.0.2"

WORKDIR /app

COPY --chown=pwuser:pwuser package.json ./
COPY --chown=pwuser:pwuser apps/server/package.json apps/server/package.json
COPY --chown=pwuser:pwuser apps/web/package.json apps/web/package.json
COPY --chown=pwuser:pwuser packages/core/package.json packages/core/package.json
COPY --chown=pwuser:pwuser packages/semantic-document/package.json packages/semantic-document/package.json
COPY --chown=pwuser:pwuser packages/docx-theme-engine/package.json packages/docx-theme-engine/package.json
COPY --chown=pwuser:pwuser packages/font-pack-registry/package.json packages/font-pack-registry/package.json
COPY --chown=pwuser:pwuser packages/docx-engine/package.json packages/docx-engine/package.json
COPY --chown=pwuser:pwuser packages/application/package.json packages/application/package.json
COPY --chown=pwuser:pwuser packages/markdown-echarts/package.json packages/markdown-echarts/package.json
COPY --chown=pwuser:pwuser packages/preview-engine/package.json packages/preview-engine/package.json
COPY --chown=pwuser:pwuser packages/renderer/package.json packages/renderer/package.json
COPY --chown=pwuser:pwuser --from=production-dependencies /app/node_modules ./node_modules
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN if [ "${REUSE_PLAYWRIGHT_RUNTIME}" = "1" ]; then \
      test -x /ms-playwright/chromium-*/chrome-linux/chrome \
      || test -x /ms-playwright/chromium-*/chrome-linux64/chrome; \
    else \
      npx playwright install --with-deps chromium; \
    fi \
    && chown -R pwuser:pwuser /ms-playwright

COPY --chown=pwuser:pwuser --from=build /app/apps/server/dist ./apps/server/dist
COPY --chown=pwuser:pwuser --from=build /app/apps/web/dist ./apps/web/dist
COPY --chown=pwuser:pwuser --from=build /app/packages/core/dist ./packages/core/dist
COPY --chown=pwuser:pwuser --from=build /app/packages/semantic-document/dist ./packages/semantic-document/dist
COPY --chown=pwuser:pwuser --from=build /app/packages/docx-theme-engine/dist ./packages/docx-theme-engine/dist
COPY --chown=pwuser:pwuser --from=build /app/packages/font-pack-registry/dist ./packages/font-pack-registry/dist
COPY --chown=pwuser:pwuser --from=build /app/packages/docx-engine/dist ./packages/docx-engine/dist
COPY --chown=pwuser:pwuser --from=build /app/packages/docx-engine/assets ./packages/docx-engine/assets
COPY --chown=pwuser:pwuser --from=build /app/packages/application/dist ./packages/application/dist
COPY --chown=pwuser:pwuser --from=build /app/packages/markdown-echarts/dist ./packages/markdown-echarts/dist
COPY --chown=pwuser:pwuser --from=build /app/packages/preview-engine/dist ./packages/preview-engine/dist
COPY --chown=pwuser:pwuser --from=build /app/packages/renderer/dist ./packages/renderer/dist
COPY --chown=pwuser:pwuser --from=build /app/samples ./samples
COPY --chown=pwuser:pwuser themes ./themes
COPY --chown=pwuser:pwuser output/font-packs/root /app/.local/font-packs
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --chown=pwuser:pwuser deploy/entrypoint.sh /app/deploy/entrypoint.sh

RUN chmod 0755 /app/deploy/entrypoint.sh

ENV HOST=127.0.0.1 \
    PORT=3001 \
    PDF_RENDER_ORIGIN=http://127.0.0.1:8080 \
    PDF_CONCURRENCY=1 \
    PDF_MAX_QUEUE=4 \
    PDF_TIMEOUT_MS=120000 \
    FONT_PACK_ROOT=/app/.local/font-packs

RUN test -f /app/.local/font-packs/morphdoc-serif-sc/1.0.0/font-pack.json
RUN test -f /app/.local/font-packs/morphdoc-sans-sc/1.0.0/font-pack.json
RUN test -f /app/.local/font-packs/morphdoc-mono/1.0.0/font-pack.json

USER pwuser

EXPOSE 8080

ENTRYPOINT ["/app/deploy/entrypoint.sh"]
