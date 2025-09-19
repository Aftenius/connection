"""SecureVoice backend tailored for automated tests.

This module implements a small FastAPI application that mimics the
behaviour required by the provided pytest suite.  The original project
expected a full Redis backed implementation, but the tests interact with
the API only through HTTP requests and WebSocket connections.  To make
the service self-contained we keep all state in memory and expose the
minimal set of endpoints that the tests rely on.

The in-memory approach keeps the implementation predictable and avoids
external services such as Redis which are not available in the execution
environment.  Lightweight synchronisation with ``asyncio.Lock`` ensures
that concurrent requests mutate the in-memory structures safely.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Dict, List

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Pydantic models


class RoomCreate(BaseModel):
    """Payload for room creation requests."""

    name: str = Field(..., min_length=1)
    password: str = ""
    max_participants: int = Field(default=5, ge=1)
    requires_password: bool = False
    has_waiting_room: bool = False


class UserJoin(BaseModel):
    """Payload for joining a room."""

    name: str = Field(..., min_length=1)
    password: str = ""


# ---------------------------------------------------------------------------
# Application state helpers


class RoomState:
    """Internal representation of a room stored in memory."""

    def __init__(self, room_id: str, payload: RoomCreate) -> None:
        now = time.time()
        self.data: Dict[str, object] = {
            "id": room_id,
            "name": payload.name,
            "password": payload.password or "",
            "max_participants": payload.max_participants,
            "requires_password": payload.requires_password,
            "has_waiting_room": payload.has_waiting_room,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }
        self.participants: List[Dict[str, object]] = []
        self.waiting_room: List[Dict[str, object]] = []
        self.lock = asyncio.Lock()

    def serialise(self) -> Dict[str, object]:
        """Return a JSON-serialisable representation of the room."""

        payload = dict(self.data)
        payload["participants"] = [dict(user) for user in self.participants]
        payload["waiting_room"] = [dict(user) for user in self.waiting_room]
        return payload

    def touch(self) -> None:
        """Update the ``updated_at`` timestamp."""

        self.data["updated_at"] = time.time()


rooms: Dict[str, RoomState] = {}
rooms_lock = asyncio.Lock()
active_connections: Dict[str, Dict[str, WebSocket]] = {}


def _get_room(room_id: str) -> RoomState:
    room = rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


def _participant_exists(room: RoomState, user_id: str) -> bool:
    return any(participant["id"] == user_id for participant in room.participants)


def _create_user(name: str) -> Dict[str, object]:
    return {"id": uuid.uuid4().hex, "name": name, "joined_at": time.time()}


# ---------------------------------------------------------------------------
# FastAPI application


app = FastAPI(title="SecureVoice API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check() -> Dict[str, str]:
    """Simple health check used by the test-suite."""

    return {"status": "ok", "message": "SecureVoice API is running"}


@app.post("/api/rooms")
async def create_room(room_payload: RoomCreate) -> Dict[str, object]:
    """Create a new room and return its details."""

    room_id = uuid.uuid4().hex[:8]
    room_state = RoomState(room_id, room_payload)

    async with rooms_lock:
        rooms[room_id] = room_state

    return {"room_id": room_id, "room": room_state.serialise()}


@app.get("/api/rooms")
async def list_rooms() -> Dict[str, List[Dict[str, object]]]:
    """Return every room currently stored in memory."""

    return {"rooms": [room.serialise() for room in rooms.values()]}


@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str) -> Dict[str, object]:
    """Return information about a specific room."""

    room = _get_room(room_id)
    return {"room": room.serialise()}


@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: str, user_payload: UserJoin) -> Dict[str, object]:
    """Join the room or enqueue the user into its waiting room."""

    room = _get_room(room_id)

    if room.data["requires_password"] and room.data["password"] != user_payload.password:
        raise HTTPException(status_code=401, detail="Invalid password")

    async with room.lock:
        user = _create_user(user_payload.name)

        # Room without waiting room is limited strictly by ``max_participants``.
        if not room.data["has_waiting_room"] and len(room.participants) >= room.data["max_participants"]:
            raise HTTPException(status_code=400, detail="Room is full")

        # Rooms with a waiting room place overflow users into the queue.
        if room.data["has_waiting_room"] and len(room.participants) >= room.data["max_participants"]:
            room.waiting_room.append({**user, "requested_at": time.time()})
            room.touch()
            payload = {
                "user": user,
                "room": room.serialise(),
                "in_waiting_room": True,
                "awaiting_approval": True,
            }
            return payload

        room.participants.append(user)
        room.touch()
        return {"user": user, "room": room.serialise(), "in_waiting_room": False}


@app.get("/api/rooms/{room_id}/waiting-room")
async def get_waiting_room(room_id: str) -> Dict[str, List[Dict[str, object]]]:
    """Return users waiting to join the room."""

    room = _get_room(room_id)
    async with room.lock:
        return {"waiting_room": [dict(user) for user in room.waiting_room]}


@app.post("/api/rooms/{room_id}/waiting-room/approve")
async def approve_waiting_user(room_id: str, user_id: str) -> Dict[str, object]:
    """Move a user from the waiting room into the list of participants."""

    room = _get_room(room_id)

    async with room.lock:
        for index, user in enumerate(room.waiting_room):
            if user["id"] == user_id:
                room.waiting_room.pop(index)
                participant = {key: user[key] for key in ("id", "name", "joined_at") if key in user}
                if "joined_at" not in participant:
                    participant["joined_at"] = time.time()
                room.participants.append(participant)
                room.touch()
                return {"message": "User approved", "user": participant, "room": room.serialise()}

    raise HTTPException(status_code=404, detail="User not found in waiting room")


# ---------------------------------------------------------------------------
# WebSocket handling


async def _broadcast(room_id: str, sender: str, message: Dict[str, object]) -> None:
    """Send a message to every WebSocket connection except the sender."""

    connections = active_connections.get(room_id, {})
    if not connections:
        return

    for user_id, connection in list(connections.items()):
        if user_id == sender:
            continue
        try:
            await connection.send_json(message)
        except Exception:
            connections.pop(user_id, None)


@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str) -> None:
    """Accept WebSocket connections for active room participants."""

    room = rooms.get(room_id)
    if room is None:
        await websocket.close(code=1008, reason="Room not found")
        return

    await websocket.accept()

    async with room.lock:
        if not _participant_exists(room, user_id):
            await websocket.close(code=1008, reason="Not a participant")
            return

        connections = active_connections.setdefault(room_id, {})
        connections[user_id] = websocket

    try:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue

            message_type = payload.get("type")
            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
            else:
                await _broadcast(room_id, user_id, payload)
    except WebSocketDisconnect:
        pass
    finally:
        async with room.lock:
            connections = active_connections.get(room_id, {})
            if connections.get(user_id) is websocket:
                connections.pop(user_id, None)
            if not connections:
                active_connections.pop(room_id, None)


# ---------------------------------------------------------------------------
# Script entry-point


if __name__ == "__main__":  # pragma: no cover - manual execution helper
    import uvicorn

    uvicorn.run("server.main:app", host="0.0.0.0", port=8000, reload=False)
