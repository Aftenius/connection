from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
import uuid
from typing import Dict, List
from pydantic import BaseModel
import asyncio
from datetime import datetime
import logging

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('server.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = FastAPI(title="SecureVoice API")

# CORS middleware для работы с React клиентом
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://client:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Модели данных
class RoomCreate(BaseModel):
    name: str
    password: str = ""
    max_participants: int = 10
    requires_password: bool = False
    has_waiting_room: bool = False

class RoomJoin(BaseModel):
    room_id: str
    password: str = ""

class UserJoin(BaseModel):
    name: str
    password: str = ""

class User(BaseModel):
    id: str
    name: str
    is_muted: bool = False
    is_speaking: bool = False

class Room(BaseModel):
    id: str
    name: str
    password: str = ""
    max_participants: int = 10
    participants: List[User] = []
    waiting_room: List[User] = []  # Зал ожидания
    is_active: bool = False
    requires_password: bool = False
    has_waiting_room: bool = False
    created_at: datetime = datetime.now()

# Хранилище данных в памяти
rooms: Dict[str, Room] = {}
active_connections: Dict[str, List[WebSocket]] = {}

@app.get("/")
async def read_root():
    return FileResponse("static/index.html")

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "SecureVoice API is running"}

@app.post("/api/rooms")
async def create_room(room_data: RoomCreate):
    """Создать новую комнату"""
    logger.info(f"POST /api/rooms - Создание комнаты: {room_data.name}")
    logger.info(f"Данные комнаты: {room_data.model_dump()}")
    
    try:
        room_id = str(uuid.uuid4())[:8]
        logger.info(f"Сгенерированный ID комнаты: {room_id}")
        
        room = Room(
            id=room_id,
            name=room_data.name,
            password=room_data.password,
            max_participants=room_data.max_participants,
            requires_password=room_data.requires_password,
            has_waiting_room=room_data.has_waiting_room
        )
        
        rooms[room_id] = room
        logger.info(f"Комната успешно создана: {room.model_dump()}")
        logger.info(f"Общее количество комнат: {len(rooms)}")
        
        return {"room_id": room_id, "room": room.model_dump()}
    except Exception as e:
        logger.error(f"Ошибка при создании комнаты: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ошибка создания комнаты: {str(e)}")

@app.get("/api/rooms")
async def get_rooms():
    """Получить список всех комнат"""
    logger.info(f"GET /api/rooms - Запрос списка комнат. Всего комнат: {len(rooms)}")
    room_list = [room.model_dump() for room in rooms.values()]
    logger.info(f"Возвращаем {len(room_list)} комнат")
    return {"rooms": room_list}

@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str):
    """Получить информацию о комнате"""
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"room": rooms[room_id].model_dump()}

@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: str, user_data: UserJoin):
    """Присоединиться к комнате"""
    logger.info(f"POST /api/rooms/{room_id}/join - Попытка присоединения к комнате")
    logger.info(f"Данные пользователя: {user_data.model_dump()}")
    
    if room_id not in rooms:
        logger.warning(f"Комната {room_id} не найдена при попытке присоединения")
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = rooms[room_id]
    logger.info(f"Комната найдена: {room.name}, участников: {len(room.participants)}/{room.max_participants}")
    
    # Проверяем, нет ли уже пользователя с таким именем в комнате
    existing_user = None
    for participant in room.participants:
        if participant.name == user_data.name:
            existing_user = participant
            break
    
    if existing_user:
        logger.info(f"Пользователь {user_data.name} уже в комнате {room_id}, возвращаем существующие данные")
        return {"user": existing_user.model_dump(), "room": room.model_dump(), "in_waiting_room": False}
    
    # Проверка пароля если требуется
    if room.requires_password and room.password and user_data.password != room.password:
        logger.warning(f"Неверный пароль для комнаты {room_id}")
        raise HTTPException(status_code=401, detail="Invalid password")
    
    user = User(
        id=str(uuid.uuid4()),
        name=user_data.name
    )
    
    # Если есть зал ожидания и комната полная, добавляем в зал ожидания
    if room.has_waiting_room and len(room.participants) >= room.max_participants:
        room.waiting_room.append(user)
        logger.info(f"Пользователь {user.name} добавлен в зал ожидания комнаты {room_id}")
        return {"user": user.model_dump(), "room": room.model_dump(), "in_waiting_room": True}
    elif len(room.participants) >= room.max_participants:
        # Если нет зала ожидания и комната полная
        logger.warning(f"Комната {room_id} переполнена")
        raise HTTPException(status_code=400, detail="Room is full")
    else:
        room.participants.append(user)
        room.is_active = True
        logger.info(f"Пользователь {user.name} успешно присоединился к комнате {room_id}")
        logger.info(f"Теперь в комнате {len(room.participants)} участников")
        
        # Уведомляем всех участников о новом пользователе
        await notify_user_joined(room_id, user)
        
        return {"user": user.model_dump(), "room": room.model_dump(), "in_waiting_room": False}

@app.post("/api/rooms/{room_id}/waiting-room/approve")
async def approve_user_from_waiting_room(room_id: str, user_id: str):
    """Одобрить пользователя из зала ожидания"""
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = rooms[room_id]
    user = next((u for u in room.waiting_room if u.id == user_id), None)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found in waiting room")
    
    if len(room.participants) >= room.max_participants:
        raise HTTPException(status_code=400, detail="Room is full")
    
    # Перемещаем пользователя из зала ожидания в основную комнату
    room.waiting_room = [u for u in room.waiting_room if u.id != user_id]
    room.participants.append(user)
    room.is_active = True
    
    logger.info(f"Пользователь {user.name} одобрен из зала ожидания комнаты {room_id}")
    return {"user": user.model_dump(), "room": room.model_dump()}

@app.post("/api/rooms/{room_id}/waiting-room/reject")
async def reject_user_from_waiting_room(room_id: str, user_id: str):
    """Отклонить пользователя из зала ожидания"""
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = rooms[room_id]
    user = next((u for u in room.waiting_room if u.id == user_id), None)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found in waiting room")
    
    # Удаляем пользователя из зала ожидания
    room.waiting_room = [u for u in room.waiting_room if u.id != user_id]
    
    logger.info(f"Пользователь {user.name} отклонен из зала ожидания комнаты {room_id}")
    return {"message": "User rejected from waiting room"}

@app.get("/api/rooms/{room_id}/waiting-room")
async def get_waiting_room(room_id: str):
    """Получить список пользователей в зале ожидания"""
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room = rooms[room_id]
    return {"waiting_room": [user.model_dump() for user in room.waiting_room]}

@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    """WebSocket endpoint для голосовой связи"""
    logger.info(f"WebSocket подключение: комната {room_id}, пользователь {user_id}")
    await websocket.accept()
    logger.info(f"WebSocket соединение установлено для пользователя {user_id}")
    
    if room_id not in active_connections:
        active_connections[room_id] = []
        logger.info(f"Создана новая группа соединений для комнаты {room_id}")
    
    active_connections[room_id].append(websocket)
    logger.info(f"Добавлено соединение в комнату {room_id}. Всего соединений: {len(active_connections[room_id])}")
    
    try:
        while True:
            # Получаем данные от клиента
            data = await websocket.receive_text()
            message = json.loads(data)
            logger.debug(f"Получено сообщение от {user_id}: {message['type']}")
            
            # Обрабатываем различные типы сообщений
            if message["type"] == "audio_data":
                # Пересылаем аудио данные всем остальным участникам
                await broadcast_to_others(room_id, websocket, data)
            elif message["type"] == "user_status":
                # Обновляем статус пользователя
                await update_user_status(room_id, user_id, message["data"])
            elif message["type"] == "speaking":
                # Обрабатываем информацию о том, что пользователь говорит
                await handle_speaking_status(room_id, user_id, message.get("is_speaking", False))
            elif message["type"] == "ping":
                # Отвечаем на ping
                await websocket.send_text(json.dumps({"type": "pong"}))
                logger.debug(f"Отправлен pong пользователю {user_id}")
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket отключение: пользователь {user_id} покинул комнату {room_id}")
        # Удаляем соединение при отключении
        if room_id in active_connections:
            active_connections[room_id].remove(websocket)
            if not active_connections[room_id]:
                del active_connections[room_id]
                logger.info(f"Удалена группа соединений для комнаты {room_id}")
        
        # Удаляем пользователя из комнаты
        if room_id in rooms:
            room = rooms[room_id]
            room.participants = [p for p in room.participants if p.id != user_id]
            if not room.participants:
                room.is_active = False
                logger.info(f"Комната {room_id} стала неактивной (нет участников)")
            else:
                # Уведомляем остальных участников об отключении пользователя
                await notify_user_left(room_id, user_id)

async def broadcast_to_others(room_id: str, sender_websocket: WebSocket, data: str):
    """Отправить данные всем участникам кроме отправителя"""
    if room_id in active_connections:
        logger.debug(f"Пересылка данных в комнате {room_id} для {len(active_connections[room_id])} соединений")
        for connection in active_connections[room_id]:
            if connection != sender_websocket:
                try:
                    await connection.send_text(data)
                except:
                    # Удаляем неактивные соединения
                    active_connections[room_id].remove(connection)
                    logger.warning(f"Удалено неактивное соединение из комнаты {room_id}")

async def update_user_status(room_id: str, user_id: str, status_data: dict):
    """Обновить статус пользователя"""
    logger.info(f"Обновление статуса пользователя {user_id} в комнате {room_id}: {status_data}")
    if room_id in rooms:
        room = rooms[room_id]
        for participant in room.participants:
            if participant.id == user_id:
                if "is_muted" in status_data:
                    participant.is_muted = status_data["is_muted"]
                if "is_speaking" in status_data:
                    participant.is_speaking = status_data["is_speaking"]
                break
        
        # Уведомляем всех участников об изменении статуса
        await broadcast_status_update(room_id, user_id, status_data)

async def broadcast_status_update(room_id: str, user_id: str, status_data: dict):
    """Отправить обновление статуса всем участникам"""
    message = {
        "type": "user_status_update",
        "user_id": user_id,
        "data": status_data
    }
    
    logger.debug(f"Отправка обновления статуса в комнату {room_id}")
    if room_id in active_connections:
        for connection in active_connections[room_id]:
            try:
                await connection.send_text(json.dumps(message))
            except:
                pass

async def handle_speaking_status(room_id: str, user_id: str, is_speaking: bool):
    """Обработать информацию о том, что пользователь говорит"""
    logger.debug(f"Пользователь {user_id} {'говорит' if is_speaking else 'молчит'} в комнате {room_id}")
    
    # Отправляем информацию всем участникам
    message = {
        "type": "speaking",
        "user_id": user_id,
        "is_speaking": is_speaking
    }
    
    if room_id in active_connections:
        for connection in active_connections[room_id]:
            try:
                await connection.send_text(json.dumps(message))
            except:
                # Удаляем неактивные соединения
                active_connections[room_id].remove(connection)
                logger.warning(f"Удалено неактивное соединение при отправке speaking статуса в комнате {room_id}")

async def notify_user_joined(room_id: str, user):
    """Уведомить всех участников о присоединении нового пользователя"""
    logger.info(f"Уведомление о присоединении пользователя {user.name} к комнате {room_id}")
    
    message = {
        "type": "user_joined",
        "user": user.model_dump()
    }
    
    if room_id in active_connections:
        for connection in active_connections[room_id]:
            try:
                await connection.send_text(json.dumps(message))
            except:
                # Удаляем неактивные соединения
                active_connections[room_id].remove(connection)
                logger.warning(f"Удалено неактивное соединение при уведомлении о присоединении в комнате {room_id}")

async def notify_participants_update(room_id: str):
    """Уведомить всех участников об обновлении списка участников"""
    if room_id not in rooms:
        return
    
    room = rooms[room_id]
    message = {
        "type": "participants_update",
        "participants": [p.model_dump() for p in room.participants]
    }
    
    if room_id in active_connections:
        for connection in active_connections[room_id]:
            try:
                await connection.send_text(json.dumps(message))
            except:
                # Удаляем неактивные соединения
                active_connections[room_id].remove(connection)
                logger.warning(f"Удалено неактивное соединение при обновлении участников в комнате {room_id}")

async def notify_user_left(room_id: str, user_id: str):
    """Уведомить всех участников об отключении пользователя"""
    logger.info(f"Уведомление об отключении пользователя {user_id} из комнаты {room_id}")
    
    message = {
        "type": "user_left",
        "user_id": user_id
    }
    
    if room_id in active_connections:
        for connection in active_connections[room_id]:
            try:
                await connection.send_text(json.dumps(message))
            except:
                # Удаляем неактивные соединения
                active_connections[room_id].remove(connection)
                logger.warning(f"Удалено неактивное соединение при уведомлении об отключении в комнате {room_id}")

# Статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    logger.info("Запуск сервера SecureVoice на порту 8000")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
