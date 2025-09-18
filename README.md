# 🎤 SecureVoice v3

Защищенное голосовое общение для команд с WebRTC и Redis.

## 🚀 Быстрый старт

### Development
```bash
git clone <your-repo>
cd securevoice
docker-compose up --build
```

### Production
```bash
git clone <your-repo>
cd securevoice
docker-compose -f docker-compose.prod.yml up --build -d
```

## 🌐 Доступ

- **Development**: http://localhost:3000
- **Production**: https://yourdomain.com

## 🔧 Конфигурация

1. Скопируйте `.env.example` в `.env`
2. Измените `REACT_APP_API_URL` для production
3. Настройте SSL сертификаты в `./ssl/`

## 📊 Архитектура

- **Frontend**: React + WebRTC
- **Backend**: FastAPI + WebSocket
- **Database**: Redis
- **Proxy**: Nginx

## ✨ Возможности

- ✅ Голосовые комнаты с WebRTC
- ✅ Система создателя и одобрения
- ✅ Пароли и залы ожидания
- ✅ Управление громкостью
- ✅ Темная тема
- ✅ Мобильная версия
- ✅ Уведомления в реальном времени