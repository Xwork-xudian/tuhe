FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    BRIDGE_PORT=8790 \
    BRIDGE_DATA_DIR=/app/data \
    TZ=Asia/Shanghai
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data
EXPOSE 8790
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
