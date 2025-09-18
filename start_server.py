#!/usr/bin/env python3
"""
Скрипт для запуска сервера SecureVoice
"""
import subprocess
import sys
import os
import time
import threading
from pathlib import Path

def run_server():
    """Запуск FastAPI сервера"""
    print("🚀 Запуск FastAPI сервера...")
    os.chdir("server")
    subprocess.run([sys.executable, "main.py"])

def run_client():
    """Запуск React клиента"""
    print("🎨 Запуск React клиента...")
    os.chdir("client")
    subprocess.run(["npm", "start"])

def install_dependencies():
    """Установка зависимостей"""
    print("📦 Установка зависимостей...")
    
    # Установка Python зависимостей
    print("Установка Python зависимостей...")
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], check=True)
        print("✅ Python зависимости установлены")
    except subprocess.CalledProcessError as e:
        print(f"❌ Ошибка установки Python зависимостей: {e}")
        return False
    
    # Проверяем наличие npm
    try:
        subprocess.run(["npm", "--version"], check=True, capture_output=True)
        print("✅ npm найден")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ npm не найден. Пожалуйста, установите Node.js с https://nodejs.org/")
        return False
    
    # Установка Node.js зависимостей
    print("Установка Node.js зависимостей...")
    try:
        os.chdir("client")
        subprocess.run(["npm", "install"], check=True)
        os.chdir("..")
        print("✅ Node.js зависимости установлены")
    except subprocess.CalledProcessError as e:
        print(f"❌ Ошибка установки Node.js зависимостей: {e}")
        os.chdir("..")
        return False
    
    return True

def main():
    """Главная функция"""
    print("🎤 SecureVoice - Защищенное голосовое общение")
    print("=" * 50)
    
    # Проверяем наличие зависимостей
    if not Path("requirements.txt").exists():
        print("❌ Файл requirements.txt не найден!")
        return
    
    if not Path("client/package.json").exists():
        print("❌ Файл client/package.json не найден!")
        return
    
    # Устанавливаем зависимости
    if not install_dependencies():
        print("\n❌ Не удалось установить зависимости. Проверьте ошибки выше.")
        return
    
    print("\n✅ Зависимости установлены!")
    print("\n🌐 Приложение будет доступно по адресам:")
    print("   - Сервер: http://localhost:8000")
    print("   - Клиент: http://localhost:3000")
    print("\n⚠️  Для тестирования голосовой связи откройте приложение в нескольких браузерах")
    print("\n🔄 Запуск сервера и клиента...")
    
    # Запускаем сервер в отдельном потоке
    server_thread = threading.Thread(target=run_server)
    server_thread.daemon = True
    server_thread.start()
    
    # Ждем немного, чтобы сервер запустился
    time.sleep(3)
    
    # Запускаем клиент
    try:
        run_client()
    except KeyboardInterrupt:
        print("\n👋 Остановка приложения...")
        sys.exit(0)

if __name__ == "__main__":
    main()
