FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "server/index.ts"]
