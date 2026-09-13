# ЦеЗошит — сервер
FROM node:20-alpine

WORKDIR /app

# сначала только манифест зависимостей — кэш слоёв
COPY package.json ./
RUN npm install --omit=dev

# остальной код
COPY src ./src
COPY public ./public

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
