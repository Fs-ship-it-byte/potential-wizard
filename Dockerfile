FROM node:20-slim

# Instalamos Chromium del SISTEMA (apt) en vez de depender del que trae
# empaquetado la imagen de Puppeteer -- eso nos dio problemas porque la
# versión de Chrome bundleada no coincidía con la que puppeteer (npm)
# esperaba encontrar en su cache path, y con PUPPETEER_SKIP_DOWNLOAD=true
# nunca bajaba nada de respaldo -> "Could not find Chrome".
# Instalando chromium por apt y apuntando PUPPETEER_EXECUTABLE_PATH directo
# al binario, no hay ambigüedad de versión posible.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# No dejamos que puppeteer intente bajar su propio Chromium: vamos a usar el
# de apt de arriba.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=7000
EXPOSE 7000

CMD ["node", "addon.js"]
