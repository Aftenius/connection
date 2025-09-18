#!/usr/bin/env python3
"""
Упрощенный скрипт для запуска только сервера SecureVoice
"""
import subprocess
import sys
import os
import time
from pathlib import Path

def install_python_dependencies():
    """Установка только Python зависимостей"""
    print("📦 Установка Python зависимостей...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], check=True)
        print("✅ Python зависимости установлены")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Ошибка установки Python зависимостей: {e}")
        return False

def run_server():
    """Запуск FastAPI сервера"""
    print("🚀 Запуск FastAPI сервера...")
    os.chdir("server")
    try:
        subprocess.run([sys.executable, "main.py"])
    except KeyboardInterrupt:
        print("\n👋 Остановка сервера...")
        sys.exit(0)

def main():
    """Главная функция"""
    print("🎤 SecureVoice - Защищенное голосовое общение")
    print("=" * 50)
    print("⚠️  Запуск только сервера (без React клиента)")
    print("   Для полного функционала установите Node.js и запустите start_server.py")
    print("=" * 50)
    
    # Проверяем наличие файлов
    if not Path("requirements.txt").exists():
        print("❌ Файл requirements.txt не найден!")
        return
    
    if not Path("server/main.py").exists():
        print("❌ Файл server/main.py не найден!")
        return
    
    # Устанавливаем зависимости
    if not install_python_dependencies():
        print("\n❌ Не удалось установить зависимости.")
        return
    
    print("\n✅ Зависимости установлены!")
    print("\n🌐 Сервер будет доступен по адресу: http://localhost:8000")
    print("📖 API документация: http://localhost:8000/docs")
    print("\n⚠️  Для тестирования откройте браузер и перейдите на http://localhost:8000")
    print("\n🔄 Запуск сервера...")
    
    # Запускаем сервер
    run_server()

if __name__ == "__main__":
    main()

