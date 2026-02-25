# Sales Reports — Node.js 18+
FROM node:18-slim

WORKDIR /app

# Native deps for better-sqlite3
RUN apt-get update -qq && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3333
ENV PORT=3333
CMD ["node", "server.js"]
