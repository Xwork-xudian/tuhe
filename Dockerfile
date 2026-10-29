FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV TUHE_PORT=8787

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build && npm prune --omit=dev

EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
