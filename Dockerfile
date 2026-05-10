FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev --no-audit --no-fund \
  && test -x ./node_modules/.bin/tsc
COPY . ./
RUN ./node_modules/.bin/tsc -p tsconfig.build.json
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
COPY assets ./assets
COPY assets/fonts /usr/local/share/fonts/inkypi
RUN fc-cache -f
EXPOSE 8010
CMD ["node", "dist/main.js"]
