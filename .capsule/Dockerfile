FROM docker.io/oven/bun@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
ARG BUN_CONFIG_MINIMUM_RELEASE_AGE
ARG BUN_CONFIG_REGISTRY
WORKDIR /workspace
COPY package.json bun.lock bunfig.toml ./
COPY packages/client/package.json packages/client/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
RUN test "$BUN_CONFIG_MINIMUM_RELEASE_AGE" = "259200" \
    && test "$BUN_CONFIG_REGISTRY" = "https://registry.npmjs.org/" \
    && bun -e 'const path="package.json"; const manifest=await Bun.file(path).json(); delete manifest.scripts; await Bun.write(path, JSON.stringify(manifest, null, 2)+"\n")' \
    && bun install --frozen-lockfile --ignore-scripts --linker=hoisted --cpu='*' --os='*' --minimum-release-age="$BUN_CONFIG_MINIMUM_RELEASE_AGE" --registry="$BUN_CONFIG_REGISTRY" --no-progress --no-summary \
    && rm -rf /root/.bun /tmp/*
COPY package.json tsconfig.json ./
COPY packages packages
COPY scripts scripts
RUN mkdir -p /capsule-output \
    && bun build --compile --minify --target=bun-linux-x64-baseline packages/client/src/index.ts --outfile /capsule-output/termenor-linux-x64 \
    && bun build --compile --minify --target=bun-linux-arm64 packages/client/src/index.ts --outfile /capsule-output/termenor-linux-arm64 \
    && bun build --compile --minify --target=bun-darwin-x64 packages/client/src/index.ts --outfile /capsule-output/termenor-darwin-x64 \
    && bun build --compile --minify --target=bun-darwin-arm64 packages/client/src/index.ts --outfile /capsule-output/termenor-darwin-arm64 \
    && bun build --compile --minify --target=bun-linux-x64-baseline packages/server/src/index.ts --outfile /capsule-output/termenor-server-linux-x64 \
    && bun build --compile --minify --target=bun-linux-arm64 packages/server/src/index.ts --outfile /capsule-output/termenor-server-linux-arm64 \
    && bun build --compile --minify --target=bun-darwin-x64 packages/server/src/index.ts --outfile /capsule-output/termenor-server-darwin-x64 \
    && bun build --compile --minify --target=bun-darwin-arm64 packages/server/src/index.ts --outfile /capsule-output/termenor-server-darwin-arm64
RUN mkdir -p /capsule-tmp && chown 65532:65532 /capsule-tmp
USER 65532:65532
ENV HOME=/home/capsule
