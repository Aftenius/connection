"""
Redis Manager для управления сессиями и комнатами
"""
import json
import time
import os
from typing import Optional, List, Dict, Any
import redis.asyncio as redis
from pydantic import BaseModel

class RedisManager:
    def __init__(self):
        redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
        self.redis = redis.from_url(redis_url, decode_responses=True)
        
    async def get_connection(self):
        """Получить соединение с Redis"""
        return self.redis
    
    # === ПОЛЬЗОВАТЕЛЬСКИЕ СЕССИИ ===
    
    async def save_user_session(self, user_id: str, session_data: dict, ttl: int = 86400):
        """Сохранить сессию пользователя (TTL = 24 часа)"""
        session_data['last_seen'] = time.time()
        await self.redis.setex(f"session:{user_id}", ttl, json.dumps(session_data))
    
    async def get_user_session(self, user_id: str) -> Optional[dict]:
        """Получить сессию пользователя"""
        data = await self.redis.get(f"session:{user_id}")
        if data:
            return json.loads(data)
        return None
    
    async def delete_user_session(self, user_id: str):
        """Удалить сессию пользователя"""
        await self.redis.delete(f"session:{user_id}")
    
    async def find_session_by_stable_id(self, stable_user_id: str) -> List[dict]:
        """Найти сессии по стабильному ID пользователя"""
        sessions = []
        try:
            session_keys = await self.redis.keys("session:*")
        except Exception:
            # Redis недоступен — не валим 500, возвращаем пустой список
            return []
        
        for key in session_keys:
            try:
                session_data = await self.redis.get(key)
                if session_data:
                    data = json.loads(session_data)
                    if data.get('stable_user_id') == stable_user_id:
                        sessions.append({
                            'session_token': key.replace('session:', ''),
                            'session_data': data
                        })
            except Exception:
                continue
        
        return sessions
    
    # === УПРАВЛЕНИЕ КОМНАТАМИ ===
    
    async def save_room(self, room_id: str, room_data: dict, ttl: int = None):
        """Сохранить комнату с настраиваемым TTL"""
        room_data['updated_at'] = time.time()
        
        if ttl is None:
            # Если создатель есть - 6 часов, если нет - 30 минут
            has_creator = room_data.get('creator_id') is not None
            ttl = 6 * 3600 if has_creator else 30 * 60
            
        await self.redis.setex(f"room:{room_id}", ttl, json.dumps(room_data))
    
    async def get_room(self, room_id: str) -> Optional[dict]:
        """Получить данные комнаты"""
        data = await self.redis.get(f"room:{room_id}")
        if data:
            return json.loads(data)
        return None
    
    async def delete_room(self, room_id: str):
        """Удалить комнату"""
        await self.redis.delete(f"room:{room_id}")
        # Также удаляем связанные данные
        await self.redis.delete(f"room_participants:{room_id}")
        await self.redis.delete(f"room_waiting:{room_id}")
        await self.redis.delete(f"room_requests:{room_id}")
    
    async def extend_room_ttl(self, room_id: str, ttl: int = 3600):
        """Продлить время жизни комнаты"""
        await self.redis.expire(f"room:{room_id}", ttl)
    
    async def get_all_rooms(self) -> List[dict]:
        """Получить все активные комнаты"""
        keys = await self.redis.keys("room:*")
        rooms = []
        for key in keys:
            if not key.startswith("room_"):  # Исключаем вспомогательные ключи
                data = await self.redis.get(key)
                if data:
                    room_data = json.loads(data)
                    room_data['id'] = key.replace('room:', '')
                    rooms.append(room_data)
        return rooms
    
    # === УЧАСТНИКИ КОМНАТЫ ===
    
    async def add_participant(self, room_id: str, user_data: dict):
        """Добавить участника в комнату"""
        participant_id = user_data.get('id') or user_data.get('user_id')
        if not participant_id:
            raise ValueError("Participant data must include 'id' or 'user_id'")

        normalized_data = user_data.copy()
        normalized_data['id'] = participant_id
        normalized_data['user_id'] = participant_id

        if not normalized_data.get('name'):
            normalized_data['name'] = f"Участник {participant_id[:8]}"

        normalized_data.setdefault('joined_at', time.time())

        await self.redis.hset(
            f"room_participants:{room_id}",
            participant_id,
            json.dumps(normalized_data)
        )
    
    async def remove_participant(self, room_id: str, user_id: str):
        """Удалить участника из комнаты"""
        await self.redis.hdel(f"room_participants:{room_id}", user_id)
    
    async def get_participants(self, room_id: str) -> List[dict]:
        """Получить всех участников комнаты"""
        participants_data = await self.redis.hgetall(f"room_participants:{room_id}")
        participants = []
        for user_id, data in participants_data.items():
            participant = json.loads(data)
            participants.append(participant)
        return participants
    
    async def is_participant(self, room_id: str, user_id: str) -> bool:
        """Проверить, является ли пользователь участником"""
        return await self.redis.hexists(f"room_participants:{room_id}", user_id)
    
    # === ЗАЛ ОЖИДАНИЯ ===
    
    async def add_to_waiting_room(self, room_id: str, user_data: dict):
        """Добавить пользователя в зал ожидания"""
        user_data['requested_at'] = time.time()
        await self.redis.hset(f"room_waiting:{room_id}", user_data['id'], json.dumps(user_data))
    
    async def remove_from_waiting_room(self, room_id: str, user_id: str):
        """Удалить пользователя из зала ожидания"""
        await self.redis.hdel(f"room_waiting:{room_id}", user_id)
    
    async def get_waiting_room(self, room_id: str) -> List[dict]:
        """Получить всех пользователей в зале ожидания"""
        waiting_data = await self.redis.hgetall(f"room_waiting:{room_id}")
        waiting_users = []
        for user_id, data in waiting_data.items():
            user = json.loads(data)
            waiting_users.append(user)
        return waiting_users
    
    # === ЗАПРОСЫ НА ПОДКЛЮЧЕНИЕ ===
    
    async def add_join_request(self, room_id: str, user_data: dict):
        """Добавить запрос на подключение к комнате"""
        request_data = {
            'user': user_data,
            'requested_at': time.time(),
            'status': 'pending'
        }
        await self.redis.hset(f"room_requests:{room_id}", user_data['id'], json.dumps(request_data))
    
    async def approve_join_request(self, room_id: str, user_id: str):
        """Одобрить запрос на подключение"""
        request_data = await self.redis.hget(f"room_requests:{room_id}", user_id)
        if request_data:
            data = json.loads(request_data)
            data['status'] = 'approved'
            data['approved_at'] = time.time()
            await self.redis.hset(f"room_requests:{room_id}", user_id, json.dumps(data))
            return data['user']
        return None
    
    async def reject_join_request(self, room_id: str, user_id: str):
        """Отклонить запрос на подключение"""
        request_data = await self.redis.hget(f"room_requests:{room_id}", user_id)
        if request_data:
            data = json.loads(request_data)
            data['status'] = 'rejected'
            data['rejected_at'] = time.time()
            await self.redis.hset(f"room_requests:{room_id}", user_id, json.dumps(data))
            # Удаляем через 5 минут
            await self.redis.expire(f"room_requests:{room_id}", 300)
    
    async def get_pending_requests(self, room_id: str) -> List[dict]:
        """Получить все ожидающие запросы"""
        requests_data = await self.redis.hgetall(f"room_requests:{room_id}")
        pending_requests = []
        for user_id, data in requests_data.items():
            request = json.loads(data)
            if request['status'] == 'pending':
                pending_requests.append(request)
        return pending_requests
    
    # === КОМНАТЫ ПОЛЬЗОВАТЕЛЯ ===
    
    async def add_user_room(self, user_id: str, room_id: str, role: str = 'creator'):
        """Добавить комнату к списку комнат пользователя"""
        room_info = {
            'room_id': room_id,
            'role': role,
            'created_at': time.time()
        }
        await self.redis.hset(f"user_rooms:{user_id}", room_id, json.dumps(room_info))
    
    async def remove_user_room(self, user_id: str, room_id: str):
        """Удалить комнату из списка пользователя"""
        await self.redis.hdel(f"user_rooms:{user_id}", room_id)
    
    async def get_user_rooms(self, user_id: str) -> List[dict]:
        """Получить все комнаты пользователя"""
        rooms_data = await self.redis.hgetall(f"user_rooms:{user_id}")
        user_rooms = []
        for room_id, data in rooms_data.items():
            room_info = json.loads(data)
            # Получаем актуальные данные комнаты
            room_data = await self.get_room(room_id)
            if room_data:
                room_info.update(room_data)
                room_info['id'] = room_id
                user_rooms.append(room_info)
            else:
                # Удаляем несуществующую комнату
                await self.remove_user_room(user_id, room_id)
        return user_rooms
    
    # === АКТИВНЫЕ СОЕДИНЕНИЯ ===
    
    async def add_active_connection(self, room_id: str, user_id: str, connection_info: dict):
        """Добавить активное соединение"""
        connection_info['connected_at'] = time.time()
        await self.redis.hset(f"room_connections:{room_id}", user_id, json.dumps(connection_info))
        await self.redis.expire(f"room_connections:{room_id}", 3600)  # 1 час
    
    async def remove_active_connection(self, room_id: str, user_id: str):
        """Удалить активное соединение"""
        await self.redis.hdel(f"room_connections:{room_id}", user_id)
    
    async def get_active_connections(self, room_id: str) -> List[dict]:
        """Получить все активные соединения"""
        connections_data = await self.redis.hgetall(f"room_connections:{room_id}")
        connections = []
        for user_id, data in connections_data.items():
            connection = json.loads(data)
            connection['user_id'] = user_id
            connections.append(connection)
        return connections
    
    # === УТИЛИТЫ ===
    
    async def cleanup_expired_rooms(self):
        """Очистка истекших комнат (вызывается периодически)"""
        current_time = time.time()
        all_rooms = await self.get_all_rooms()
        
        for room in all_rooms:
            # Удаляем комнаты старше 6 часов без активности
            if current_time - room.get('updated_at', 0) > 21600:  # 6 часов
                await self.delete_room(room['id'])
    
    async def get_room_stats(self, room_id: str) -> dict:
        """Получить статистику комнаты"""
        participants = await self.get_participants(room_id)
        waiting_users = await self.get_waiting_room(room_id)
        pending_requests = await self.get_pending_requests(room_id)
        active_connections = await self.get_active_connections(room_id)
        
        return {
            'participants_count': len(participants),
            'waiting_count': len(waiting_users),
            'pending_requests_count': len(pending_requests),
            'active_connections_count': len(active_connections),
            'participants': participants,
            'waiting_room': waiting_users,
            'pending_requests': pending_requests
        }

# Глобальный экземпляр
redis_manager = RedisManager()
