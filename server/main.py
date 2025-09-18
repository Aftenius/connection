"""
SecureVoice Backend v2 с Redis и системой сессий
"""
import json
import uuid
import logging
import time
import asyncio
import hashlib
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from redis_manager import redis_manager

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/server.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = FastAPI(title="SecureVoice API v2", version="2.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://client:3000", "http://192.168.127.134:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Активные WebSocket соединения
active_connections: Dict[str, List[WebSocket]] = {}

# Pydantic модели
class UserSession(BaseModel):
    user_id: str
    name: str
    ip_address: str
    user_agent: str
    created_at: float
    last_seen: float

class RoomCreate(BaseModel):
    name: str
    password: str = ""
    max_participants: int = 10
    requires_password: bool = False
    has_waiting_room: bool = True  # По умолчанию включен зал ожидания

class UserJoin(BaseModel):
    name: str
    password: str = ""
    session_token: Optional[str] = None

class Room(BaseModel):
    id: str
    name: str
    password: str
    creator_id: str
    creator_name: str
    max_participants: int
    requires_password: bool
    has_waiting_room: bool
    is_active: bool
    created_at: float
    updated_at: float

class User(BaseModel):
    id: str
    name: str
    ip_address: str = ""
    is_creator: bool = False
    joined_at: float
    is_muted: bool = False
    is_speaking: bool = False

# === UTILS ===

def generate_user_hash(name: str, ip: str, user_agent: str) -> str:
    """Генерация уникального хэша пользователя"""
    # Используем имя, IP, user agent и временную метку для уникальности
    data = f"{name.lower().strip()}-{ip}-{user_agent}-{int(time.time() // 3600)}"  # Обновляется каждый час
    hash_obj = hashlib.sha256(data.encode('utf-8'))
    return hash_obj.hexdigest()[:16]  # Берем первые 16 символов

def generate_stable_user_id(name: str, ip: str, user_agent: str) -> str:
    """Генерация стабильного ID пользователя для сессии"""
    # Более стабильный хэш для долгосрочной идентификации
    data = f"{name.lower().strip()}-{ip}-{user_agent[:50]}"  # Обрезаем user_agent
    hash_obj = hashlib.md5(data.encode('utf-8'))
    return hash_obj.hexdigest()

# === MIDDLEWARE ===

@app.middleware("http")
async def add_client_info(request, call_next):
    """Добавляем информацию о клиенте в запрос"""
    client_ip = request.client.host
    user_agent = request.headers.get("user-agent", "")
    request.state.client_ip = client_ip
    request.state.user_agent = user_agent
    response = await call_next(request)
    return response

# === ENDPOINTS ===

@app.get("/api/health")
async def health_check():
    """Проверка здоровья сервера"""
    return {"status": "ok", "message": "SecureVoice API v2 is running"}

@app.post("/api/session")
async def create_or_get_session(request: Request):
    """Создать или получить сессию пользователя"""
    data = await request.json()
    name = data.get("name", "").strip()
    session_token = data.get("session_token")
    
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    
    client_ip = request.state.client_ip
    user_agent = request.state.user_agent
    
    # Генерируем стабильный ID для пользователя
    stable_user_id = generate_stable_user_id(name, client_ip, user_agent)
    
    # Если есть токен сессии, пытаемся восстановить
    if session_token:
        session = await redis_manager.get_user_session(session_token)
        if session and session.get('stable_user_id') == stable_user_id:
            # Обновляем время последнего визита
            session['last_seen'] = time.time()
            session['ip_address'] = client_ip
            session['name'] = name  # Обновляем имя на случай изменения
            await redis_manager.save_user_session(session_token, session)
            logger.info(f"Восстановлена сессия для пользователя {name} (ID: {stable_user_id[:8]})")
            return {"session_token": session_token, "user": session}
    
    # Проверяем существующую сессию по стабильному ID
    existing_sessions = await redis_manager.find_session_by_stable_id(stable_user_id)
    if existing_sessions:
        session_token = existing_sessions[0]['session_token']
        session = existing_sessions[0]['session_data']
        session['last_seen'] = time.time()
        session['name'] = name
        await redis_manager.save_user_session(session_token, session)
        logger.info(f"Найдена существующая сессия для пользователя {name} (ID: {stable_user_id[:8]})")
        return {"session_token": session_token, "user": session}
    
    # Создаем новую сессию
    user_id = str(uuid.uuid4())
    user_hash = generate_user_hash(name, client_ip, user_agent)
    
    session_data = {
        "user_id": user_id,
        "stable_user_id": stable_user_id,
        "user_hash": user_hash,
        "name": name,
        "ip_address": client_ip,
        "user_agent": user_agent,
        "created_at": time.time(),
        "last_seen": time.time()
    }
    
    await redis_manager.save_user_session(user_id, session_data)
    logger.info(f"Создана новая сессия для пользователя {name} (Hash: {user_hash}, ID: {stable_user_id[:8]})")
    
    return {"session_token": user_id, "user": session_data}

@app.post("/api/rooms")
async def create_room(room_data: RoomCreate, request: Request):
    """Создать новую комнату"""
    # Получаем данные создателя из заголовков
    session_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not session_token:
        raise HTTPException(status_code=401, detail="Session token required")
    
    session = await redis_manager.get_user_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    room_id = str(uuid.uuid4())[:8]  # Короткий ID для удобства
    creator_id = session['user_id']
    creator_name = session['name']
    
    # Создаем комнату
    room = Room(
        id=room_id,
        name=room_data.name,
        password=room_data.password,
        creator_id=creator_id,
        creator_name=creator_name,
        max_participants=room_data.max_participants,
        requires_password=room_data.requires_password,
        has_waiting_room=room_data.has_waiting_room,
        is_active=True,
        created_at=time.time(),
        updated_at=time.time()
    )
    
    # Сохраняем в Redis
    await redis_manager.save_room(room_id, room.model_dump())
    
    # Добавляем создателя как участника
    creator = User(
        id=creator_id,
        name=creator_name,
        ip_address=session.get('ip_address', ''),
        is_creator=True,
        joined_at=time.time()
    )
    await redis_manager.add_participant(room_id, creator.model_dump())
    
    # Добавляем комнату к списку комнат пользователя
    await redis_manager.add_user_room(creator_id, room_id, 'creator')
    
    logger.info(f"Создана комната {room_id} ({room_data.name}) пользователем {creator_name}")
    
    return {
        "room_id": room_id, 
        "room": room.model_dump(),
        "user": creator.model_dump()
    }

@app.get("/api/rooms")
async def get_rooms():
    """Получить список всех активных комнат"""
    rooms = await redis_manager.get_all_rooms()
    
    # Добавляем статистику для каждой комнаты
    for room in rooms:
        stats = await redis_manager.get_room_stats(room['id'])
        room.update(stats)
    
    return {"rooms": rooms}

@app.get("/api/rooms/{room_id}")
async def get_room_info(room_id: str):
    """Получить информацию о комнате"""
    room = await redis_manager.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    stats = await redis_manager.get_room_stats(room_id)
    room.update(stats)
    
    return {"room": room}

@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: str, user_data: UserJoin, request: Request):
    """Присоединиться к комнате"""
    # Получаем сессию пользователя
    session_token = user_data.session_token or request.headers.get("Authorization", "").replace("Bearer ", "")
    if not session_token:
        raise HTTPException(status_code=401, detail="Session token required")
    
    session = await redis_manager.get_user_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    # Проверяем существование комнаты
    room_data = await redis_manager.get_room(room_id)
    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Проверяем пароль если требуется
    if room_data['requires_password'] and room_data['password'] and user_data.password != room_data['password']:
        logger.warning(f"Неверный пароль для комнаты {room_id}")
        raise HTTPException(status_code=401, detail="Invalid password")
    
    user_id = session['user_id']
    user_name = user_data.name if user_data.name.strip() else session['name']
    
    # Проверяем, не является ли пользователь уже участником
    if await redis_manager.is_participant(room_id, user_id):
        # Возвращаем существующие данные
        participants = await redis_manager.get_participants(room_id)
        user = next((p for p in participants if p['id'] == user_id), None)
        room_data['participants'] = participants
        logger.info(f"Пользователь {user_name} уже в комнате {room_id}")
        return {"user": user, "room": room_data, "in_waiting_room": False}
    
    # Создаем объект пользователя
    user = User(
        id=user_id,
        name=user_name,
        ip_address=session.get('ip_address', ''),
        is_creator=user_id == room_data['creator_id'],
        joined_at=time.time()
    )
    
    # Проверяем, нужно ли добавлять в зал ожидания
    participants = await redis_manager.get_participants(room_id)
    is_creator = user_id == room_data['creator_id']
    
    if is_creator:
        # Создатель может присоединиться сразу
        await redis_manager.add_participant(room_id, user.model_dump())
        logger.info(f"Создатель {user_name} присоединился к комнате {room_id}")
        
        # Уведомляем других участников
        await notify_user_joined(room_id, user.model_dump())
        
        room_data['participants'] = await redis_manager.get_participants(room_id)
        return {"user": user.model_dump(), "room": room_data, "in_waiting_room": False}
    
    elif room_data['has_waiting_room']:
        # Все остальные идут в зал ожидания для одобрения
        await redis_manager.add_join_request(room_id, user.model_dump())
        logger.info(f"Пользователь {user_name} добавлен в запросы на подключение к комнате {room_id}")
        
        # Уведомляем создателя о новом запросе
        await notify_creator_about_request(room_id, user.model_dump())
        
        return {"user": user.model_dump(), "room": room_data, "in_waiting_room": True, "awaiting_approval": True}
    
    elif len(participants) >= room_data['max_participants']:
        # Если нет зала ожидания и комната полная
        logger.warning(f"Комната {room_id} переполнена")
        raise HTTPException(status_code=400, detail="Room is full")
    
    else:
        # Добавляем участника сразу
        await redis_manager.add_participant(room_id, user.model_dump())
        logger.info(f"Пользователь {user_name} присоединился к комнате {room_id}")
        
        # Уведомляем других участников
        await notify_user_joined(room_id, user.model_dump())
        
        room_data['participants'] = await redis_manager.get_participants(room_id)
        return {"user": user.model_dump(), "room": room_data, "in_waiting_room": False}

@app.post("/api/rooms/{room_id}/approve")
async def approve_user(room_id: str, request: Request):
    """Одобрить пользователя (только для создателя)"""
    data = await request.json()
    user_id_to_approve = data.get("user_id")
    
    # Получаем сессию текущего пользователя
    session_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    session = await redis_manager.get_user_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    # Проверяем права создателя
    room_data = await redis_manager.get_room(room_id)
    if not room_data or session['user_id'] != room_data['creator_id']:
        raise HTTPException(status_code=403, detail="Only room creator can approve users")
    
    # Одобряем пользователя
    approved_user = await redis_manager.approve_join_request(room_id, user_id_to_approve)
    if not approved_user:
        raise HTTPException(status_code=404, detail="Join request not found")
    
    # Проверяем лимит участников
    participants = await redis_manager.get_participants(room_id)
    if len(participants) >= room_data['max_participants']:
        raise HTTPException(status_code=400, detail="Room is full")
    
    # Добавляем пользователя в комнату
    approved_user['joined_at'] = time.time()
    await redis_manager.add_participant(room_id, approved_user)
    
    # Уведомляем всех участников
    await notify_user_joined(room_id, approved_user)
    await notify_user_approved(room_id, approved_user)
    
    logger.info(f"Пользователь {approved_user['name']} одобрен в комнату {room_id}")
    
    return {"message": "User approved", "user": approved_user}

@app.post("/api/rooms/{room_id}/reject")
async def reject_user(room_id: str, request: Request):
    """Отклонить пользователя (только для создателя)"""
    data = await request.json()
    user_id_to_reject = data.get("user_id")
    
    # Получаем сессию текущего пользователя
    session_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    session = await redis_manager.get_user_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    # Проверяем права создателя
    room_data = await redis_manager.get_room(room_id)
    if not room_data or session['user_id'] != room_data['creator_id']:
        raise HTTPException(status_code=403, detail="Only room creator can reject users")
    
    # Отклоняем пользователя
    await redis_manager.reject_join_request(room_id, user_id_to_reject)
    
    # Уведомляем пользователя об отклонении
    await notify_user_rejected(room_id, user_id_to_reject)
    
    logger.info(f"Пользователь {user_id_to_reject} отклонен из комнаты {room_id}")
    
    return {"message": "User rejected"}

@app.get("/api/rooms/{room_id}/requests")
async def get_join_requests(room_id: str, request: Request):
    """Получить список запросов на подключение (только для создателя)"""
    # Получаем сессию текущего пользователя
    session_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    session = await redis_manager.get_user_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    # Проверяем права создателя
    room_data = await redis_manager.get_room(room_id)
    if not room_data or session['user_id'] != room_data['creator_id']:
        raise HTTPException(status_code=403, detail="Only room creator can view join requests")
    
    requests = await redis_manager.get_pending_requests(room_id)
    return {"requests": requests}

@app.delete("/api/rooms/{room_id}")
async def delete_room(room_id: str, request: Request):
    """Удалить комнату (только для создателя)"""
    # Получаем сессию текущего пользователя
    session_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    session = await redis_manager.get_user_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    # Проверяем права создателя
    room_data = await redis_manager.get_room(room_id)
    if not room_data or session['user_id'] != room_data['creator_id']:
        raise HTTPException(status_code=403, detail="Only room creator can delete room")
    
    # Уведомляем всех участников об удалении комнаты
    await notify_room_deleted(room_id)
    
    # Удаляем комнату
    await redis_manager.delete_room(room_id)
    await redis_manager.remove_user_room(session['user_id'], room_id)
    
    logger.info(f"Комната {room_id} удалена пользователем {session['name']}")
    
    return {"message": "Room deleted"}

@app.get("/api/user/rooms")
async def get_user_rooms(request: Request):
    """Получить комнаты пользователя"""
    session_token = request.headers.get("Authorization", "").replace("Bearer ", "")
    session = await redis_manager.get_user_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    user_rooms = await redis_manager.get_user_rooms(session['user_id'])
    return {"rooms": user_rooms}

# === WEBSOCKET ===

@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    """WebSocket endpoint для голосовой связи"""
    logger.info(f"WebSocket подключение: комната {room_id}, пользователь {user_id}")
    await websocket.accept()
    
    # Проверяем, что пользователь является участником комнаты
    if not await redis_manager.is_participant(room_id, user_id):
        await websocket.close(code=4003, reason="Not a participant")
        return
    
    if room_id not in active_connections:
        active_connections[room_id] = []
    
    active_connections[room_id].append(websocket)
    
    # Добавляем в активные соединения Redis
    await redis_manager.add_active_connection(room_id, user_id, {"status": "connected"})
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Обрабатываем различные типы сообщений
            if message["type"] == "speaking":
                await handle_speaking_status(room_id, user_id, message.get("is_speaking", False))
            elif message["type"] == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            else:
                # Пересылаем сообщение другим участникам
                await broadcast_to_others(room_id, websocket, data)
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket отключение: пользователь {user_id} покинул комнату {room_id}")
        
        # Удаляем соединение
        if room_id in active_connections:
            if websocket in active_connections[room_id]:
                active_connections[room_id].remove(websocket)
            if not active_connections[room_id]:
                del active_connections[room_id]
        
        # Удаляем из активных соединений Redis
        await redis_manager.remove_active_connection(room_id, user_id)
        
        # Уведомляем остальных участников
        await notify_user_left(room_id, user_id)

# === HELPER FUNCTIONS ===

async def broadcast_to_others(room_id: str, sender_websocket: WebSocket, data: str):
    """Отправить данные всем участникам кроме отправителя"""
    if room_id in active_connections:
        for connection in active_connections[room_id]:
            if connection != sender_websocket:
                try:
                    await connection.send_text(data)
                except:
                    active_connections[room_id].remove(connection)

async def broadcast_to_all(room_id: str, message: dict):
    """Отправить сообщение всем участникам комнаты"""
    if room_id in active_connections:
        message_str = json.dumps(message)
        for connection in active_connections[room_id]:
            try:
                await connection.send_text(message_str)
            except:
                active_connections[room_id].remove(connection)

async def notify_creator_only(room_id: str, message: dict):
    """Отправить сообщение только создателю комнаты"""
    room_data = await redis_manager.get_room(room_id)
    if not room_data:
        return
    
    creator_id = room_data['creator_id']
    
    if room_id in active_connections:
        message_str = json.dumps(message)
        for connection in active_connections[room_id]:
            # Здесь нужно определить, какое соединение принадлежит создателю
            # Это можно сделать через дополнительное отслеживание соединений
            try:
                await connection.send_text(message_str)
            except:
                active_connections[room_id].remove(connection)

async def handle_speaking_status(room_id: str, user_id: str, is_speaking: bool):
    """Обработать информацию о том, что пользователь говорит"""
    message = {
        "type": "speaking",
        "user_id": user_id,
        "is_speaking": is_speaking
    }
    await broadcast_to_all(room_id, message)

async def notify_user_joined(room_id: str, user: dict):
    """Уведомить всех участников о присоединении нового пользователя"""
    message = {
        "type": "user_joined",
        "user": user
    }
    await broadcast_to_all(room_id, message)

async def notify_user_left(room_id: str, user_id: str):
    """Уведомить всех участников об отключении пользователя"""
    message = {
        "type": "user_left",
        "user_id": user_id
    }
    await broadcast_to_all(room_id, message)

async def notify_creator_about_request(room_id: str, user: dict):
    """Уведомить создателя о новом запросе на подключение"""
    message = {
        "type": "join_request",
        "user": user,
        "room_id": room_id
    }
    await notify_creator_only(room_id, message)

async def notify_user_approved(room_id: str, user: dict):
    """Уведомить пользователя об одобрении"""
    message = {
        "type": "join_approved",
        "user": user,
        "room_id": room_id
    }
    # Отправляем конкретному пользователю
    await broadcast_to_all(room_id, message)

async def notify_user_rejected(room_id: str, user_id: str):
    """Уведомить пользователя об отклонении"""
    message = {
        "type": "join_rejected",
        "user_id": user_id,
        "room_id": room_id
    }
    # Здесь нужно отправить конкретному пользователю
    await broadcast_to_all(room_id, message)

async def notify_room_deleted(room_id: str):
    """Уведомить всех участников об удалении комнаты"""
    message = {
        "type": "room_deleted",
        "room_id": room_id
    }
    await broadcast_to_all(room_id, message)

# === ПЕРИОДИЧЕСКИЕ ЗАДАЧИ ===

async def cleanup_task():
    """Периодическая очистка истекших комнат"""
    while True:
        try:
            await redis_manager.cleanup_expired_rooms()
            await asyncio.sleep(3600)  # Каждый час
        except Exception as e:
            logger.error(f"Ошибка в cleanup_task: {e}")
            await asyncio.sleep(60)

@app.on_event("startup")
async def startup_event():
    """Запуск фоновых задач"""
    asyncio.create_task(cleanup_task())
    logger.info("SecureVoice Server v2 запущен")

# Статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    logger.info("Запуск сервера SecureVoice v2 на порту 8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
