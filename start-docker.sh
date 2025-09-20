#!/bin/bash

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

echo "🐳 Запуск SecureVoice в Docker контейнерах..."
echo

# Создаем .env файл если его нет
if [ ! -f .env ]; then
    echo "📝 Создаем файл .env с настройками по умолчанию..."
    cat > .env << EOF
# Порты для сервисов
SERVER_PORT=8000
CLIENT_PORT=3000
REDIS_PORT=6379
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443

# Среда разработки
ENVIRONMENT=development

# URL для API
REACT_APP_API_URL=http://localhost:8000

# Настройки для разработки
COMPOSE_PROJECT_NAME=securevoice
EOF
fi

# Проверяем, доступны ли порты
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
        echo "⚠️  Порт $port уже используется"
        return 1
    fi
    return 0
}

# Загружаем переменные из .env
source .env

echo "🔍 Проверяем доступность портов..."
PORTS_OK=true
check_port ${SERVER_PORT:-8000} || PORTS_OK=false
check_port ${CLIENT_PORT:-3000} || PORTS_OK=false
check_port ${REDIS_PORT:-6379} || PORTS_OK=false

if [ "$PORTS_OK" = false ]; then
    echo "❌ Некоторые порты заняты. Остановите другие сервисы или измените порты в .env файле."
    exit 1
fi

echo "📦 Сборка и запуск контейнеров..."
docker-compose up --build --remove-orphans

echo
echo "✅ Приложение запущено!"
echo "🌐 Сервер: http://localhost:${SERVER_PORT:-8000}"
echo "🎨 Клиент: http://localhost:${CLIENT_PORT:-3000}"
if [ "${NGINX_HTTP_PORT:-80}" != "80" ]; then
    echo "🌍 Nginx: http://localhost:${NGINX_HTTP_PORT:-80}"
else
    echo "🌍 Nginx: http://localhost"
fi
echo
echo "Нажмите Ctrl+C для остановки"
