#!/bin/bash

echo "🔒 Настройка SSL сертификата для app.webnoir.ru"

# Создаем временную nginx конфигурацию для получения сертификата
cat > /tmp/nginx-temp.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    server {
        listen 80;
        server_name app.webnoir.ru;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 200 "OK";
            add_header Content-Type text/plain;
        }
    }
}
EOF

echo "📋 Backup существующей nginx конфигурации..."
cp nginx/nginx.conf nginx/nginx.conf.backup

echo "🔄 Используем временную конфигурацию для получения сертификата..."
cp /tmp/nginx-temp.conf nginx/nginx.conf

echo "🚀 Запускаем nginx для Let's Encrypt verification..."
docker-compose up -d nginx

echo "⏳ Ждем запуска nginx..."
sleep 10

echo "📜 Получаем SSL сертификат..."
docker-compose run --rm certbot

echo "✅ Восстанавливаем полную nginx конфигурацию..."
cp nginx/nginx.conf.backup nginx/nginx.conf

echo "🔄 Перезапускаем nginx с SSL..."
docker-compose restart nginx

echo "🎉 SSL настроен! Приложение доступно по https://app.webnoir.ru"
