#!/usr/bin/env python3
"""
Упрощенные тесты для SecureVoice API (без pytest)
"""
import requests
import json
import time

BASE_URL = "http://192.168.127.134:8000"

def test_health_check():
    """Тест проверки здоровья сервера"""
    print("🔍 Тестирование health check...")
    try:
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        print("✅ Health check passed")
        return True
    except Exception as e:
        print(f"❌ Health check failed: {e}")
        return False

def test_create_room_basic():
    """Тест создания базовой комнаты"""
    print("🏠 Тестирование создания базовой комнаты...")
    try:
        room_data = {
            "name": "Test Room Basic",
            "password": "",
            "max_participants": 5,
            "requires_password": False,
            "has_waiting_room": False
        }
        
        response = requests.post(f"{BASE_URL}/api/rooms", json=room_data)
        assert response.status_code == 200
        
        data = response.json()
        assert "room_id" in data
        assert data["room"]["name"] == "Test Room Basic"
        assert data["room"]["max_participants"] == 5
        assert not data["room"]["requires_password"]
        assert not data["room"]["has_waiting_room"]
        
        print("✅ Basic room creation passed")
        return data["room_id"]
    except Exception as e:
        print(f"❌ Basic room creation failed: {e}")
        return None

def test_create_room_with_password():
    """Тест создания комнаты с паролем"""
    print("🔐 Тестирование создания комнаты с паролем...")
    try:
        room_data = {
            "name": "Test Room Password",
            "password": "secret123",
            "max_participants": 3,
            "requires_password": True,
            "has_waiting_room": False
        }
        
        response = requests.post(f"{BASE_URL}/api/rooms", json=room_data)
        assert response.status_code == 200
        
        data = response.json()
        assert data["room"]["requires_password"] == True
        assert data["room"]["password"] == "secret123"
        
        print("✅ Password room creation passed")
        return data["room_id"]
    except Exception as e:
        print(f"❌ Password room creation failed: {e}")
        return None

def test_create_room_with_waiting_room():
    """Тест создания комнаты с залом ожидания"""
    print("⏳ Тестирование создания комнаты с залом ожидания...")
    try:
        room_data = {
            "name": "Test Room Waiting",
            "password": "",
            "max_participants": 2,
            "requires_password": False,
            "has_waiting_room": True
        }
        
        response = requests.post(f"{BASE_URL}/api/rooms", json=room_data)
        assert response.status_code == 200
        
        data = response.json()
        assert data["room"]["has_waiting_room"] == True
        assert data["room"]["max_participants"] == 2
        
        print("✅ Waiting room creation passed")
        return data["room_id"]
    except Exception as e:
        print(f"❌ Waiting room creation failed: {e}")
        return None

def test_join_room_success(room_id):
    """Тест успешного присоединения к комнате"""
    print("👤 Тестирование присоединения к комнате...")
    try:
        user_data = {
            "name": "Test User",
            "password": ""
        }
        
        response = requests.post(f"{BASE_URL}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 200
        
        data = response.json()
        assert data["user"]["name"] == "Test User"
        assert data["room"]["participants"][0]["name"] == "Test User"
        assert not data["in_waiting_room"]
        
        print("✅ Room join success passed")
        return True
    except Exception as e:
        print(f"❌ Room join failed: {e}")
        return False

def test_join_room_with_password(room_id):
    """Тест присоединения к комнате с паролем"""
    print("🔑 Тестирование присоединения с паролем...")
    try:
        # Попытка с неверным паролем
        user_data = {
            "name": "Test User",
            "password": "wrongpass"
        }
        
        response = requests.post(f"{BASE_URL}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 401
        
        # Присоединение с правильным паролем
        user_data["password"] = "secret123"
        response = requests.post(f"{BASE_URL}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 200
        
        print("✅ Password room join passed")
        return True
    except Exception as e:
        print(f"❌ Password room join failed: {e}")
        return False

def test_waiting_room_functionality(room_id):
    """Тест функционала зала ожидания"""
    print("⏳ Тестирование зала ожидания...")
    try:
        # Добавляем 2 участников (комната заполняется)
        for i in range(2):
            user_data = {
                "name": f"User {i+1}",
                "password": ""
            }
            response = requests.post(f"{BASE_URL}/api/rooms/{room_id}/join", json=user_data)
            assert response.status_code == 200
            assert not response.json()["in_waiting_room"]
        
        # Третий пользователь должен попасть в зал ожидания
        user_data = {
            "name": "Waiting User",
            "password": ""
        }
        response = requests.post(f"{BASE_URL}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 200
        assert response.json()["in_waiting_room"]
        
        # Проверяем зал ожидания
        response = requests.get(f"{BASE_URL}/api/rooms/{room_id}/waiting-room")
        assert response.status_code == 200
        waiting_room = response.json()["waiting_room"]
        assert len(waiting_room) == 1
        assert waiting_room[0]["name"] == "Waiting User"
        
        print("✅ Waiting room functionality passed")
        return True
    except Exception as e:
        print(f"❌ Waiting room functionality failed: {e}")
        return False

def test_get_rooms_list():
    """Тест получения списка комнат"""
    print("📋 Тестирование получения списка комнат...")
    try:
        response = requests.get(f"{BASE_URL}/api/rooms")
        assert response.status_code == 200
        
        data = response.json()
        assert "rooms" in data
        assert isinstance(data["rooms"], list)
        
        print("✅ Get rooms list passed")
        return True
    except Exception as e:
        print(f"❌ Get rooms list failed: {e}")
        return False

def test_error_handling():
    """Тест обработки ошибок"""
    print("⚠️ Тестирование обработки ошибок...")
    try:
        # Несуществующая комната
        response = requests.get(f"{BASE_URL}/api/rooms/nonexistent")
        assert response.status_code == 404
        
        # Присоединение к несуществующей комнате
        user_data = {"name": "Test User", "password": ""}
        response = requests.post(f"{BASE_URL}/api/rooms/nonexistent/join", json=user_data)
        assert response.status_code == 404
        
        print("✅ Error handling passed")
        return True
    except Exception as e:
        print(f"❌ Error handling failed: {e}")
        return False

def main():
    """Главная функция тестирования"""
    print("🧪 Запуск упрощенных тестов SecureVoice API")
    print("=" * 60)
    
    tests_passed = 0
    tests_failed = 0
    
    # Тест 1: Health check
    if test_health_check():
        tests_passed += 1
    else:
        tests_failed += 1
    
    # Тест 2: Создание базовой комнаты
    basic_room_id = test_create_room_basic()
    if basic_room_id:
        tests_passed += 1
        # Тест присоединения к базовой комнате
        if test_join_room_success(basic_room_id):
            tests_passed += 1
        else:
            tests_failed += 1
    else:
        tests_failed += 1
    
    # Тест 3: Создание комнаты с паролем
    password_room_id = test_create_room_with_password()
    if password_room_id:
        tests_passed += 1
        # Тест присоединения с паролем
        if test_join_room_with_password(password_room_id):
            tests_passed += 1
        else:
            tests_failed += 1
    else:
        tests_failed += 1
    
    # Тест 4: Создание комнаты с залом ожидания
    waiting_room_id = test_create_room_with_waiting_room()
    if waiting_room_id:
        tests_passed += 1
        # Тест функционала зала ожидания
        if test_waiting_room_functionality(waiting_room_id):
            tests_passed += 1
        else:
            tests_failed += 1
    else:
        tests_failed += 1
    
    # Тест 5: Получение списка комнат
    if test_get_rooms_list():
        tests_passed += 1
    else:
        tests_failed += 1
    
    # Тест 6: Обработка ошибок
    if test_error_handling():
        tests_passed += 1
    else:
        tests_failed += 1
    
    print("\n" + "=" * 60)
    print(f"📊 Результаты тестирования:")
    print(f"   ✅ Пройдено: {tests_passed}")
    print(f"   ❌ Провалено: {tests_failed}")
    print(f"   📈 Успешность: {tests_passed/(tests_passed+tests_failed)*100:.1f}%")
    
    if tests_failed == 0:
        print("\n🎉 Все тесты прошли успешно!")
        print("🌐 Приложение готово к использованию:")
        print("   - Клиент: http://localhost")
        print("   - API: http://localhost/api")
        print("   - API Docs: http://localhost/docs")
    else:
        print(f"\n⚠️  {tests_failed} тестов провалились")
    
    return tests_failed == 0

if __name__ == "__main__":
    main()
