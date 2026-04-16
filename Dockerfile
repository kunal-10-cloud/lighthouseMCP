FROM node:20-slim

# Install Chromium and all required dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    libx11-xcb1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell chrome-launcher and Lighthouse where Chrome is
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Cloud Run sets PORT env var (default 8080)
ENV PORT=8080

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

EXPOSE 8080

CMD ["node", "--expose-gc", "--max-old-space-size=512", "server.js"]
