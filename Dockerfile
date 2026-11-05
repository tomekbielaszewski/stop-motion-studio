FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=3000
EXPOSE 3000
VOLUME /app/data
CMD ["npm", "start"]
