#!/bin/bash

echo "🐳 Запуск SecureVoice в Docker контейнерах..."
echo

echo "📦 Сборка и запуск контейнеров..."
docker-compose up --build

echo
echo "✅ Приложение запущено!"
echo "🌐 Сервер: http://localhost:8000"
echo "🎨 Клиент: http://localhost:3000"
echo
echo "Нажмите Ctrl+C для остановки"
