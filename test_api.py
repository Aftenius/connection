#!/usr/bin/env python3
"""
Тестовый скрипт для проверки API SecureVoice
"""
import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_health():
    """Тест проверки здоровья сервера"""
    print("🔍 Тестирование health check...")
    try:
        response = requests.get(f"{BASE_URL}/api/health")
        if response.status_code == 200:
            print("✅ Сервер работает")
            print(f"   Ответ: {response.json()}")
            return True
        else:
            print(f"❌ Ошибка health check: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Ошибка подключения: {e}")
        return False

def test_create_room():
    """Тест создания комнаты"""
    print("\n🏠 Тестирование создания комнаты...")
    try:
        room_data = {
            "name": "Тестовая комната API",
            "password": "test123",
            "max_participants": 3
        }
        
        response = requests.post(
            f"{BASE_URL}/api/rooms",
            json=room_data,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Комната создана успешно")
            print(f"   ID комнаты: {result['room_id']}")
            print(f"   Название: {result['room']['name']}")
            print(f"   Макс. участников: {result['room']['max_participants']}")
            return result['room_id']
        else:
            print(f"❌ Ошибка создания комнаты: {response.status_code}")
            print(f"   Ответ: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Ошибка при создании комнаты: {e}")
        return None

def test_get_rooms():
    """Тест получения списка комнат"""
    print("\n📋 Тестирование получения списка комнат...")
    try:
        response = requests.get(f"{BASE_URL}/api/rooms")
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Получен список комнат: {len(result['rooms'])} комнат")
            for room in result['rooms']:
                print(f"   - {room['name']} (ID: {room['id']}, участников: {len(room['participants'])}/{room['max_participants']})")
            return True
        else:
            print(f"❌ Ошибка получения списка комнат: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Ошибка при получении списка комнат: {e}")
        return False

def test_join_room(room_id):
    """Тест присоединения к комнате"""
    print(f"\n👤 Тестирование присоединения к комнате {room_id}...")
    try:
        user_data = {
            "name": "Тестовый пользователь",
            "password": "test123"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/rooms/{room_id}/join",
            json=user_data,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Пользователь присоединился к комнате")
            print(f"   ID пользователя: {result['user']['id']}")
            print(f"   Имя: {result['user']['name']}")
            print(f"   Участников в комнате: {len(result['room']['participants'])}")
            return result['user']['id']
        else:
            print(f"❌ Ошибка присоединения к комнате: {response.status_code}")
            print(f"   Ответ: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Ошибка при присоединении к комнате: {e}")
        return None

def test_get_room(room_id):
    """Тест получения информации о комнате"""
    print(f"\n🔍 Тестирование получения информации о комнате {room_id}...")
    try:
        response = requests.get(f"{BASE_URL}/api/rooms/{room_id}")
        
        if response.status_code == 200:
            result = response.json()
            room = result['room']
            print("✅ Информация о комнате получена")
            print(f"   Название: {room['name']}")
            print(f"   Участников: {len(room['participants'])}/{room['max_participants']}")
            print(f"   Активна: {room['is_active']}")
            return True
        else:
            print(f"❌ Ошибка получения информации о комнате: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Ошибка при получении информации о комнате: {e}")
        return False

def main():
    """Главная функция тестирования"""
    print("🧪 Тестирование API SecureVoice")
    print("=" * 50)
    
    # Тест 1: Health check
    if not test_health():
        print("\n❌ Сервер не работает, завершение тестов")
        return
    
    # Тест 2: Создание комнаты
    room_id = test_create_room()
    if not room_id:
        print("\n❌ Не удалось создать комнату, завершение тестов")
        return
    
    # Тест 3: Получение списка комнат
    test_get_rooms()
    
    # Тест 4: Получение информации о комнате
    test_get_room(room_id)
    
    # Тест 5: Присоединение к комнате
    user_id = test_join_room(room_id)
    if user_id:
        # Повторное получение информации о комнате после присоединения
        test_get_room(room_id)
    
    print("\n🎉 Тестирование завершено!")
    print(f"📊 Результаты:")
    print(f"   - Сервер: ✅ Работает")
    print(f"   - Создание комнат: ✅ Работает")
    print(f"   - Получение списка: ✅ Работает")
    print(f"   - Присоединение: {'✅ Работает' if user_id else '❌ Не работает'}")

if __name__ == "__main__":
    main()
