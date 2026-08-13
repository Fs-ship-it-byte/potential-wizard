FROM ghcr.io/puppeteer/puppeteer:22.0.0

# La imagen de Puppeteer ya trae Node, Chromium y todas las libs del sistema
# que necesita (evita el infierno de dependencias apt de node:slim).
USER root
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=7000
# Le decimos a Puppeteer que use el Chromium que ya viene en la imagen en vez
# de intentar descargar otro durante el npm install.
ENV PUPPETEER_SKIP_DOWNLOAD=true

USER pptruser
EXPOSE 7000

CMD ["node", "addon.js"]
