FROM node:20-bookworm-slim AS build
ENV NODE_ENV=development
ENV NPM_CONFIG_PRODUCTION=false
ENV NPM_CONFIG_OMIT=
WORKDIR /app
COPY package*.json ./
COPY . ./
RUN npm ci --include=dev --no-audit --no-fund \
  && npm run build \
  && npm prune --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
COPY assets ./assets
EXPOSE 8010
CMD ["node", "dist/main.js"]
