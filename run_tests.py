#!/usr/bin/env python3
"""
Скрипт для запуска всех тестов SecureVoice
"""
import subprocess
import sys
import time
import requests
import os

def check_docker_containers():
    """Проверка запущенных Docker контейнеров"""
    print("🔍 Проверка Docker контейнеров...")
    
    try:
        result = subprocess.run(['docker-compose', 'ps'], capture_output=True, text=True)
        if 'Up' in result.stdout:
            print("✅ Docker контейнеры запущены")
            return True
        else:
            print("❌ Docker контейнеры не запущены")
            return False
    except Exception as e:
        print(f"❌ Ошибка проверки контейнеров: {e}")
        return False

def wait_for_api():
    """Ожидание готовности API"""
    print("⏳ Ожидание готовности API...")
    
    max_attempts = 30
    for attempt in range(max_attempts):
        try:
            response = requests.get("http://localhost/api/health", timeout=5)
            if response.status_code == 200:
                print("✅ API готов к работе")
                return True
        except:
            pass
        
        time.sleep(2)
        print(f"   Попытка {attempt + 1}/{max_attempts}...")
    
    print("❌ API не отвечает")
    return False

def install_test_dependencies():
    """Установка зависимостей для тестов"""
    print("📦 Установка зависимостей для тестов...")
    
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "websocket-client", "pytest"], check=True)
        print("✅ Зависимости установлены")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Ошибка установки зависимостей: {e}")
        return False

def run_comprehensive_tests():
    """Запуск комплексных тестов"""
    print("🧪 Запуск комплексных тестов...")
    
    try:
        # Импортируем и запускаем тесты
        sys.path.append(os.path.dirname(os.path.abspath(__file__)))
        from tests.test_comprehensive import run_comprehensive_tests
        
        success = run_comprehensive_tests()
        return success
    except Exception as e:
        print(f"❌ Ошибка запуска тестов: {e}")
        return False

def run_api_tests():
    """Запуск базовых API тестов"""
    print("🔧 Запуск базовых API тестов...")
    
    try:
        # Тест health check
        response = requests.get("http://localhost/api/health")
        if response.status_code != 200:
            print("❌ Health check failed")
            return False
        
        # Тест создания комнаты
        room_data = {
            "name": "Test Room",
            "password": "",
            "max_participants": 5,
            "requires_password": False,
            "has_waiting_room": False
        }
        
        response = requests.post("http://localhost/api/rooms", json=room_data)
        if response.status_code != 200:
            print("❌ Room creation failed")
            return False
        
        room_id = response.json()["room_id"]
        
        # Тест присоединения к комнате
        user_data = {
            "name": "Test User",
            "password": ""
        }
        
        response = requests.post(f"http://localhost/api/rooms/{room_id}/join", json=user_data)
        if response.status_code != 200:
            print("❌ Room join failed")
            return False
        
        print("✅ Базовые API тесты прошли")
        return True
        
    except Exception as e:
        print(f"❌ Ошибка API тестов: {e}")
        return False

def main():
    """Главная функция"""
    print("🚀 Запуск тестов SecureVoice")
    print("=" * 50)
    
    # Проверяем Docker контейнеры
    if not check_docker_containers():
        print("\n❌ Запустите Docker контейнеры сначала:")
        print("   docker-compose up --build -d")
        return False
    
    # Ждем готовности API
    if not wait_for_api():
        print("\n❌ API не готов к работе")
        return False
    
    # Устанавливаем зависимости
    if not install_test_dependencies():
        print("\n❌ Не удалось установить зависимости")
        return False
    
    print("\n" + "=" * 50)
    
    # Запускаем базовые тесты
    if not run_api_tests():
        print("\n❌ Базовые тесты провалились")
        return False
    
    # Запускаем комплексные тесты
    if not run_comprehensive_tests():
        print("\n❌ Комплексные тесты провалились")
        return False
    
    print("\n🎉 Все тесты прошли успешно!")
    print("🌐 Приложение готово к использованию:")
    print("   - Клиент: http://localhost")
    print("   - API: http://localhost/api")
    print("   - API Docs: http://localhost/docs")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
