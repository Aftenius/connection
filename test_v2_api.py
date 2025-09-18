#!/usr/bin/env python3
"""
Тестирование SecureVoice API v2 с Redis и сессиями
"""
import requests
import json
import time

BASE_URL = "http://192.168.127.134:8000"

def test_v2_session_api():
    """Тестирование новой системы сессий"""
    print("🧪 Тестирование SecureVoice API v2")
    print("=" * 60)
    
    # 1. Health check
    print("🔍 Проверка здоровья сервера v2...")
    try:
        response = requests.get(f"{BASE_URL}/api/health")
        data = response.json()
        print(f"✅ Health check: {data['message']}")
    except Exception as e:
        print(f"❌ Health check failed: {e}")
        return False
    
    # 2. Создание сессии
    print("\n👤 Тестирование создания сессии...")
    try:
        session_data = {
            "name": "Test User V2"
        }
        response = requests.post(f"{BASE_URL}/api/session", json=session_data)
        if response.status_code == 200:
            data = response.json()
            session_token = data['session_token']
            user_data = data['user']
            print(f"✅ Сессия создана: {user_data['name']} (ID: {session_token[:8]}...)")
        else:
            print(f"❌ Ошибка создания сессии: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Session creation failed: {e}")
        return False
    
    # 3. Создание комнаты с авторизацией
    print("\n🏠 Тестирование создания комнаты...")
    try:
        headers = {
            'Authorization': f'Bearer {session_token}',
            'Content-Type': 'application/json'
        }
        room_data = {
            "name": "Test Room V2",
            "password": "test123",
            "max_participants": 5,
            "requires_password": True,
            "has_waiting_room": True
        }
        response = requests.post(f"{BASE_URL}/api/rooms", json=room_data, headers=headers)
        if response.status_code == 200:
            data = response.json()
            room_id = data['room_id']
            room = data['room']
            user = data['user']
            print(f"✅ Комната создана: {room['name']} (ID: {room_id})")
            print(f"   Создатель: {user['name']} (is_creator: {user['is_creator']})")
            print(f"   Зал ожидания: {'Да' if room['has_waiting_room'] else 'Нет'}")
        else:
            print(f"❌ Ошибка создания комнаты: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Room creation failed: {e}")
        return False
    
    # 4. Получение списка комнат
    print("\n📋 Тестирование получения списка комнат...")
    try:
        response = requests.get(f"{BASE_URL}/api/rooms")
        if response.status_code == 200:
            data = response.json()
            rooms = data['rooms']
            print(f"✅ Найдено комнат: {len(rooms)}")
            for room in rooms:
                print(f"   - {room['name']}: {room['participants_count']}/{room['max_participants']} участников")
        else:
            print(f"❌ Ошибка получения комнат: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Get rooms failed: {e}")
        return False
    
    # 5. Получение комнат пользователя
    print("\n👤 Тестирование получения комнат пользователя...")
    try:
        response = requests.get(f"{BASE_URL}/api/user/rooms", headers=headers)
        if response.status_code == 200:
            data = response.json()
            user_rooms = data['rooms']
            print(f"✅ Комнат пользователя: {len(user_rooms)}")
            for room in user_rooms:
                print(f"   - {room['name']} (роль: {room['role']})")
        else:
            print(f"❌ Ошибка получения комнат пользователя: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Get user rooms failed: {e}")
        return False
    
    # 6. Создание второй сессии для тестирования запросов
    print("\n👥 Тестирование запроса на подключение...")
    try:
        session_data2 = {
            "name": "Test User 2"
        }
        response = requests.post(f"{BASE_URL}/api/session", json=session_data2)
        data2 = response.json()
        session_token2 = data2['session_token']
        
        # Попытка присоединиться к комнате
        headers2 = {
            'Authorization': f'Bearer {session_token2}',
            'Content-Type': 'application/json'
        }
        join_data = {
            "name": "Test User 2",
            "password": "test123",
            "session_token": session_token2
        }
        response = requests.post(f"{BASE_URL}/api/rooms/{room_id}/join", json=join_data, headers=headers2)
        if response.status_code == 200:
            data = response.json()
            if data.get('awaiting_approval'):
                print("✅ Пользователь добавлен в очередь запросов")
            else:
                print("✅ Пользователь присоединился к комнате")
        else:
            print(f"❌ Ошибка присоединения: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Join request failed: {e}")
        return False
    
    # 7. Проверка Redis подключения
    print("\n🔴 Проверка Redis...")
    try:
        import subprocess
        result = subprocess.run(['docker', 'exec', '-it', 'connention-redis-1', 'redis-cli', 'ping'], 
                              capture_output=True, text=True, timeout=5)
        if 'PONG' in result.stdout:
            print("✅ Redis работает")
        else:
            print("❌ Redis не отвечает")
    except Exception as e:
        print(f"⚠️ Не удалось проверить Redis: {e}")
    
    print("\n" + "=" * 60)
    print("🎉 Все тесты API v2 прошли успешно!")
    print("\n📍 Доступные адреса:")
    print(f"   - Клиент: http://192.168.127.134:3000")
    print(f"   - API: http://192.168.127.134:8000")
    print(f"   - API Docs: http://192.168.127.134:8000/docs")
    print(f"   - Redis: 192.168.127.134:6379")
    
    return True

if __name__ == "__main__":
    test_v2_session_api()
