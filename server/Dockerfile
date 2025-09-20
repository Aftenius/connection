# Multi-stage build для оптимизации
FROM python:3.11-slim as base

# Устанавливаем системные зависимости
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Создаем пользователя для безопасности
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файл зависимостей
COPY requirements.txt .

# Устанавливаем зависимости
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Development stage
FROM base as development
# Копируем код приложения
COPY . .
# Создаем директории
RUN mkdir -p /app/logs /app/data && \
    chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["python", "main.py"]

# Production stage
FROM base as production
# Копируем только необходимые файлы
COPY --chown=appuser:appuser *.py ./
COPY --chown=appuser:appuser static/ ./static/ 2>/dev/null || true
# Создаем директории
RUN mkdir -p /app/logs /app/data && \
    chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1
CMD ["python", "main.py"]
