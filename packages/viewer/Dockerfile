# syntax=docker/dockerfile:1.6
# Build from the repo root: docker build -f packages/viewer/Dockerfile -t fidelity-viewer .
# Run:                      docker run -p 8080:8080 -v /path/to/results:/data -e FIDELITY_ROOT=/data fidelity-viewer
FROM node:26-slim AS build
ENV CI=true
RUN npm install -g pnpm@11.0.8
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter '@fidelity-kit/viewer...' \
 && pnpm --filter '@fidelity-kit/core' exec tsc -b \
 && pnpm --filter '@fidelity-kit/viewer' build

FROM node:26-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/packages/viewer/.output ./
CMD ["node", "server/index.mjs"]
