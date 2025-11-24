FROM node:20-alpine AS base

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

# Install dependencies separately to optimize caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY src ./src
COPY data ./data

# Ensure uploads directory exists even if host volume is empty
RUN mkdir -p /app/src/uploads

EXPOSE 8080

CMD ["node", "src/server.js"]

