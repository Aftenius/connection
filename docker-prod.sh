#!/bin/bash

echo "🚀 Запуск SecureVoice в production режиме..."

# Проверяем, установлен ли Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не установлен. Пожалуйста, установите Docker сначала."
    exit 1
fi

# Проверяем, установлен ли Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose не установлен. Пожалуйста, установите Docker Compose сначала."
    exit 1
fi

# Создаем production .env файл если его нет
if [ ! -f .env.production ]; then
    echo "📝 Создаем файл .env.production..."
    cat > .env.production << EOF
# Production настройки
SERVER_PORT=8000
CLIENT_PORT=3000
REDIS_PORT=6379
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443

# Production среда
ENVIRONMENT=production

# URL для API (замените на ваш домен)
REACT_APP_API_URL=https://yourdomain.com

# Настройки для production
COMPOSE_PROJECT_NAME=securevoice-prod
EOF
    echo "⚠️  Не забудьте настроить .env.production с вашими production настройками!"
fi

# Создаем production docker-compose файл если его нет
if [ ! -f docker-compose.prod.yml ]; then
    echo "📝 Создаем production docker-compose конфигурацию..."
    cat > docker-compose.prod.yml << 'EOF'
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    networks:
      - securevoice-network
    restart: always
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  server:
    build: 
      context: ./server
      dockerfile: Dockerfile
      target: production
    ports:
      - "${SERVER_PORT:-8000}:8000"
    volumes:
      - server_data:/app/data
      - server_logs:/app/logs
    environment:
      - PYTHONUNBUFFERED=1
      - HOST=0.0.0.0
      - PORT=8000
      - REDIS_URL=redis://redis:6379
      - ENVIRONMENT=production
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - securevoice-network
    restart: always

  client:
    build: 
      context: ./client
      dockerfile: Dockerfile
      target: production
    ports:
      - "${CLIENT_PORT:-3000}:3000"
    environment:
      - REACT_APP_API_URL=${REACT_APP_API_URL}
    depends_on:
      - server
    networks:
      - securevoice-network
    restart: always

  nginx:
    image: nginx:alpine
    ports:
      - "${NGINX_HTTP_PORT:-80}:80"
      - "${NGINX_HTTPS_PORT:-443}:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/conf.d:/etc/nginx/conf.d
      - nginx_logs:/var/log/nginx
    depends_on:
      - server
      - client
    networks:
      - securevoice-network
    restart: always

networks:
  securevoice-network:
    driver: bridge

volumes:
  redis_data:
  server_data:
  server_logs:
  nginx_logs:
EOF
fi

echo "🔄 Останавливаем существующие контейнеры..."
docker-compose down

echo "🏗️  Сборка production образов..."
docker-compose -f docker-compose.prod.yml --env-file .env.production build --no-cache

echo "🚀 Запуск production контейнеров..."
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

echo
echo "✅ Production окружение запущено!"
echo "🌐 Приложение доступно по адресу указанному в REACT_APP_API_URL"
echo
echo "📊 Для мониторинга используйте:"
echo "   docker-compose -f docker-compose.prod.yml logs -f"
echo
echo "🛑 Для остановки используйте:"
echo "   docker-compose -f docker-compose.prod.yml down"
