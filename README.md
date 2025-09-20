# 🎤 SecureVoice v3

Защищенное голосовое общение для команд с WebRTC и Redis.

## 🚀 Быстрый старт

### 🐳 Docker (Рекомендуется)

```bash
git clone <your-repo>
cd securevoice

# Development
./start-docker.sh

# Production
./docker-prod.sh
```

### 📱 Без Docker

```bash
# Backend
cd server
pip install -r requirements.txt
python main.py

# Frontend
cd client
npm install
npm start

# Redis
redis-server
```

## 🌐 Доступ

- **Development**: http://localhost:3000
- **Production**: https://yourdomain.com

## 🔧 Конфигурация

### Docker (автоматическая настройка)
- Файл `.env` создается автоматически при первом запуске
- Для production отредактируйте `.env.production`

### Ручная настройка
1. Скопируйте `.env.example` в `.env`
2. Измените `REACT_APP_API_URL` для production
3. Настройте SSL сертификаты в `./ssl/`

📖 **Подробная документация**: [DOCKER-README.md](./DOCKER-README.md)

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