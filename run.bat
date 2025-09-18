@echo off
echo 🎤 SecureVoice - Защищенное голосовое общение
echo ==================================================
echo.

REM Проверяем наличие Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python не найден! Установите Python с https://python.org
    pause
    exit /b 1
)

echo ✅ Python найден
echo.

REM Устанавливаем зависимости
echo 📦 Установка зависимостей...
pip install -r requirements.txt >nul 2>&1
if errorlevel 1 (
    echo ❌ Ошибка установки зависимостей
    pause
    exit /b 1
)

echo ✅ Зависимости установлены
echo.

REM Запускаем сервер
echo 🚀 Запуск сервера...
echo.
echo 🌐 Приложение будет доступно по адресу: http://localhost:8000
echo 📖 API документация: http://localhost:8000/docs
echo.
echo ⚠️  Для остановки нажмите Ctrl+C
echo.

cd server
python main.py

