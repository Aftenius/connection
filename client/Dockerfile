# Multi-stage build для оптимизации
FROM node:18-alpine as base

# Устанавливаем curl для health checks
RUN apk add --no-cache curl

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Development stage
FROM base as development
# Устанавливаем все зависимости (включая dev)
RUN npm install
# Копируем исходный код
COPY . .
# Меняем владельца файлов
RUN chown -R nextjs:nodejs /app
USER nextjs
EXPOSE 3000
CMD ["npm", "start"]

# Build stage для production
FROM base as builder
# Устанавливаем зависимости
RUN npm install
# Копируем исходный код
COPY . .
# Собираем приложение
RUN npm run build

# Production stage
FROM node:18-alpine as production
RUN apk add --no-cache curl
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

WORKDIR /app

# Копируем package.json для установки только production зависимостей
COPY package*.json ./
RUN npm install --only=production && npm cache clean --force

# Копируем собранное приложение
COPY --from=builder --chown=nextjs:nodejs /app/build ./build
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000 || exit 1

# Используем serve для production
USER root
RUN npm install -g serve && npm cache clean --force
USER nextjs
CMD ["serve", "-s", "build", "-l", "3000"]
