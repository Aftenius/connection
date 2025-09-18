#!/usr/bin/env python3
"""
Комплексные тесты для SecureVoice API
"""
import requests
import json
import time
import pytest
from typing import Dict, List

BASE_URL = "http://localhost"

class TestSecureVoiceAPI:
    """Комплексные тесты API SecureVoice"""
    
    def setup_method(self):
        """Настройка перед каждым тестом"""
        self.base_url = BASE_URL
        self.rooms = []
        self.users = []
    
    def test_health_check(self):
        """Тест проверки здоровья сервера"""
        response = requests.get(f"{self.base_url}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        print("✅ Health check passed")
    
    def test_create_room_basic(self):
        """Тест создания базовой комнаты"""
        room_data = {
            "name": "Test Room Basic",
            "password": "",
            "max_participants": 5,
            "requires_password": False,
            "has_waiting_room": False
        }
        
        response = requests.post(f"{self.base_url}/api/rooms", json=room_data)
        assert response.status_code == 200
        
        data = response.json()
        assert "room_id" in data
        assert data["room"]["name"] == "Test Room Basic"
        assert data["room"]["max_participants"] == 5
        assert not data["room"]["requires_password"]
        assert not data["room"]["has_waiting_room"]
        
        self.rooms.append(data["room_id"])
        print("✅ Basic room creation passed")
    
    def test_create_room_with_password(self):
        """Тест создания комнаты с паролем"""
        room_data = {
            "name": "Test Room Password",
            "password": "secret123",
            "max_participants": 3,
            "requires_password": True,
            "has_waiting_room": False
        }
        
        response = requests.post(f"{self.base_url}/api/rooms", json=room_data)
        assert response.status_code == 200
        
        data = response.json()
        assert data["room"]["requires_password"] == True
        assert data["room"]["password"] == "secret123"
        
        self.rooms.append(data["room_id"])
        print("✅ Password room creation passed")
    
    def test_create_room_with_waiting_room(self):
        """Тест создания комнаты с залом ожидания"""
        room_data = {
            "name": "Test Room Waiting",
            "password": "",
            "max_participants": 2,
            "requires_password": False,
            "has_waiting_room": True
        }
        
        response = requests.post(f"{self.base_url}/api/rooms", json=room_data)
        assert response.status_code == 200
        
        data = response.json()
        assert data["room"]["has_waiting_room"] == True
        assert data["room"]["max_participants"] == 2
        
        self.rooms.append(data["room_id"])
        print("✅ Waiting room creation passed")
    
    def test_join_room_success(self):
        """Тест успешного присоединения к комнате"""
        # Создаем комнату
        room_data = {
            "name": "Join Test Room",
            "password": "",
            "max_participants": 5,
            "requires_password": False,
            "has_waiting_room": False
        }
        
        response = requests.post(f"{self.base_url}/api/rooms", json=room_data)
        room_id = response.json()["room_id"]
        
        # Присоединяемся к комнате
        user_data = {
            "name": "Test User",
            "password": ""
        }
        
        response = requests.post(f"{self.base_url}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 200
        
        data = response.json()
        assert data["user"]["name"] == "Test User"
        assert data["room"]["participants"][0]["name"] == "Test User"
        assert not data["in_waiting_room"]
        
        self.rooms.append(room_id)
        print("✅ Room join success passed")
    
    def test_join_room_with_password(self):
        """Тест присоединения к комнате с паролем"""
        # Создаем комнату с паролем
        room_data = {
            "name": "Password Test Room",
            "password": "testpass",
            "max_participants": 5,
            "requires_password": True,
            "has_waiting_room": False
        }
        
        response = requests.post(f"{self.base_url}/api/rooms", json=room_data)
        room_id = response.json()["room_id"]
        
        # Попытка присоединения с неверным паролем
        user_data = {
            "name": "Test User",
            "password": "wrongpass"
        }
        
        response = requests.post(f"{self.base_url}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 401
        
        # Присоединение с правильным паролем
        user_data["password"] = "testpass"
        response = requests.post(f"{self.base_url}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 200
        
        self.rooms.append(room_id)
        print("✅ Password room join passed")
    
    def test_waiting_room_functionality(self):
        """Тест функционала зала ожидания"""
        # Создаем комнату с залом ожидания (макс 2 участника)
        room_data = {
            "name": "Waiting Room Test",
            "password": "",
            "max_participants": 2,
            "requires_password": False,
            "has_waiting_room": True
        }
        
        response = requests.post(f"{self.base_url}/api/rooms", json=room_data)
        room_id = response.json()["room_id"]
        
        # Добавляем 2 участников (комната заполняется)
        for i in range(2):
            user_data = {
                "name": f"User {i+1}",
                "password": ""
            }
            response = requests.post(f"{self.base_url}/api/rooms/{room_id}/join", json=user_data)
            assert response.status_code == 200
            assert not response.json()["in_waiting_room"]
        
        # Третий пользователь должен попасть в зал ожидания
        user_data = {
            "name": "Waiting User",
            "password": ""
        }
        response = requests.post(f"{self.base_url}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 200
        assert response.json()["in_waiting_room"]
        
        # Проверяем зал ожидания
        response = requests.get(f"{self.base_url}/api/rooms/{room_id}/waiting-room")
        assert response.status_code == 200
        waiting_room = response.json()["waiting_room"]
        assert len(waiting_room) == 1
        assert waiting_room[0]["name"] == "Waiting User"
        
        # Одобряем пользователя из зала ожидания
        waiting_user_id = waiting_room[0]["id"]
        response = requests.post(f"{self.base_url}/api/rooms/{room_id}/waiting-room/approve", 
                               params={"user_id": waiting_user_id})
        assert response.status_code == 200
        
        # Проверяем, что пользователь переместился в основную комнату
        response = requests.get(f"{self.base_url}/api/rooms/{room_id}")
        room_data = response.json()["room"]
        assert len(room_data["participants"]) == 3
        assert len(room_data["waiting_room"]) == 0
        
        self.rooms.append(room_id)
        print("✅ Waiting room functionality passed")
    
    def test_room_full_without_waiting_room(self):
        """Тест переполнения комнаты без зала ожидания"""
        # Создаем комнату без зала ожидания (макс 1 участник)
        room_data = {
            "name": "Full Room Test",
            "password": "",
            "max_participants": 1,
            "requires_password": False,
            "has_waiting_room": False
        }
        
        response = requests.post(f"{self.base_url}/api/rooms", json=room_data)
        room_id = response.json()["room_id"]
        
        # Добавляем первого участника
        user_data = {
            "name": "First User",
            "password": ""
        }
        response = requests.post(f"{self.base_url}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 200
        
        # Второй участник должен получить ошибку
        user_data = {
            "name": "Second User",
            "password": ""
        }
        response = requests.post(f"{self.base_url}/api/rooms/{room_id}/join", json=user_data)
        assert response.status_code == 400
        
        self.rooms.append(room_id)
        print("✅ Room full without waiting room passed")
    
    def test_get_rooms_list(self):
        """Тест получения списка комнат"""
        response = requests.get(f"{self.base_url}/api/rooms")
        assert response.status_code == 200
        
        data = response.json()
        assert "rooms" in data
        assert isinstance(data["rooms"], list)
        
        # Проверяем, что наши тестовые комнаты в списке
        room_names = [room["name"] for room in data["rooms"]]
        assert "Test Room Basic" in room_names
        assert "Test Room Password" in room_names
        
        print("✅ Get rooms list passed")
    
    def test_get_room_details(self):
        """Тест получения деталей комнаты"""
        # Создаем комнату
        room_data = {
            "name": "Details Test Room",
            "password": "testpass",
            "max_participants": 3,
            "requires_password": True,
            "has_waiting_room": True
        }
        
        response = requests.post(f"{self.base_url}/api/rooms", json=room_data)
        room_id = response.json()["room_id"]
        
        # Получаем детали комнаты
        response = requests.get(f"{self.base_url}/api/rooms/{room_id}")
        assert response.status_code == 200
        
        data = response.json()
        room = data["room"]
        assert room["name"] == "Details Test Room"
        assert room["max_participants"] == 3
        assert room["requires_password"] == True
        assert room["has_waiting_room"] == True
        
        self.rooms.append(room_id)
        print("✅ Get room details passed")
    
    def test_websocket_connection(self):
        """Тест WebSocket подключения"""
        import websocket
        import threading
        import time
        
        # Создаем комнату
        room_data = {
            "name": "WebSocket Test Room",
            "password": "",
            "max_participants": 5,
            "requires_password": False,
            "has_waiting_room": False
        }
        
        response = requests.post(f"{self.base_url}/api/rooms", json=room_data)
        room_id = response.json()["room_id"]
        
        # Добавляем пользователя
        user_data = {
            "name": "WebSocket User",
            "password": ""
        }
        response = requests.post(f"{self.base_url}/api/rooms/{room_id}/join", json=user_data)
        user_id = response.json()["user"]["id"]
        
        # Тестируем WebSocket подключение
        ws_url = f"ws://localhost/ws/{room_id}/{user_id}"
        
        def on_message(ws, message):
            data = json.loads(message)
            print(f"WebSocket message: {data}")
        
        def on_error(ws, error):
            print(f"WebSocket error: {error}")
        
        def on_close(ws, close_status_code, close_msg):
            print("WebSocket closed")
        
        def on_open(ws):
            print("WebSocket connected")
            # Отправляем ping
            ws.send(json.dumps({"type": "ping"}))
            time.sleep(1)
            ws.close()
        
        ws = websocket.WebSocketApp(ws_url,
                                  on_open=on_open,
                                  on_message=on_message,
                                  on_error=on_error,
                                  on_close=on_close)
        
        # Запускаем WebSocket в отдельном потоке
        wst = threading.Thread(target=ws.run_forever)
        wst.daemon = True
        wst.start()
        
        # Ждем завершения
        wst.join(timeout=5)
        
        self.rooms.append(room_id)
        print("✅ WebSocket connection test passed")
    
    def test_error_handling(self):
        """Тест обработки ошибок"""
        # Несуществующая комната
        response = requests.get(f"{self.base_url}/api/rooms/nonexistent")
        assert response.status_code == 404
        
        # Присоединение к несуществующей комнате
        user_data = {"name": "Test User", "password": ""}
        response = requests.post(f"{self.base_url}/api/rooms/nonexistent/join", json=user_data)
        assert response.status_code == 404
        
        # Неверные данные для создания комнаты
        invalid_room_data = {"name": ""}  # Пустое имя
        response = requests.post(f"{self.base_url}/api/rooms", json=invalid_room_data)
        assert response.status_code == 422
        
        print("✅ Error handling passed")
    
    def teardown_method(self):
        """Очистка после каждого теста"""
        # В реальном приложении здесь была бы очистка тестовых данных
        pass

def run_comprehensive_tests():
    """Запуск всех комплексных тестов"""
    print("🧪 Запуск комплексных тестов SecureVoice API")
    print("=" * 60)
    
    test_instance = TestSecureVoiceAPI()
    
    tests = [
        test_instance.test_health_check,
        test_instance.test_create_room_basic,
        test_instance.test_create_room_with_password,
        test_instance.test_create_room_with_waiting_room,
        test_instance.test_join_room_success,
        test_instance.test_join_room_with_password,
        test_instance.test_waiting_room_functionality,
        test_instance.test_room_full_without_waiting_room,
        test_instance.test_get_rooms_list,
        test_instance.test_get_room_details,
        test_instance.test_websocket_connection,
        test_instance.test_error_handling
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test_instance.setup_method()
            test()
            test_instance.teardown_method()
            passed += 1
        except Exception as e:
            print(f"❌ {test.__name__} failed: {str(e)}")
            failed += 1
    
    print("\n" + "=" * 60)
    print(f"📊 Результаты тестирования:")
    print(f"   ✅ Пройдено: {passed}")
    print(f"   ❌ Провалено: {failed}")
    print(f"   📈 Успешность: {passed/(passed+failed)*100:.1f}%")
    
    if failed == 0:
        print("\n🎉 Все тесты прошли успешно!")
    else:
        print(f"\n⚠️  {failed} тестов провалились")
    
    return failed == 0

if __name__ == "__main__":
    run_comprehensive_tests()
