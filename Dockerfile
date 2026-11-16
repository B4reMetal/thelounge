# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

# Shared base: corepack provides the yarn version pinned in package.json, git
# is needed because irc-framework is a git dependency (fetched over HTTPS, the
# lockfile records it as git+ssh).
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
	&& corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# Build the client and server once, on the runner's own architecture: the
# output is plain JS and CSS, so it is the same for every target platform.
FROM --platform=$BUILDPLATFORM base AS build
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable
COPY . .
RUN NODE_ENV=production yarn build

# Runtime dependencies for the target platform (better-sqlite3 is native).
FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn workspaces focus --all --production \
	&& yarn cache clean --all

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
	THELOUNGE_HOME=/var/opt/thelounge
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/client/index.html.tpl ./client/index.html.tpl
COPY --from=build /app/index.js /app/package.json /app/.thelounge_home ./

# Same user (uid 1000) and data path as the official image, so an existing
# data volume can be mounted as is
RUN mkdir -p "$THELOUNGE_HOME" && chown node:node "$THELOUNGE_HOME"
USER node
VOLUME /var/opt/thelounge
EXPOSE 9000

ENTRYPOINT ["node", "/app/index.js"]
CMD ["start"]
