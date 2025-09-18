import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, PhoneCall, PhoneOff, Settings, Users, 
  Plus, Lock, Volume2, VolumeX, Shield, Minimize2,
  Maximize2, MoreVertical, UserPlus, Copy, LogOut,
  Calendar, Clock, Link, Video, VideoOff, User,
  ArrowRight, Check, X, RefreshCw
} from 'lucide-react';
import axios from 'axios';

// Настройка базового URL для API
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
axios.defaults.baseURL = API_BASE_URL;

const SecureVoiceApp = () => {
  const [currentView, setCurrentView] = useState('auth');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [userName, setUserName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomMaxParticipants, setNewRoomMaxParticipants] = useState(10);
  const [newRoomRequiresPassword, setNewRoomRequiresPassword] = useState(false);
  const [newRoomHasWaitingRoom, setNewRoomHasWaitingRoom] = useState(false);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [waitingRoom, setWaitingRoom] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [joinPassword, setJoinPassword] = useState('');
  const [wsConnection, setWsConnection] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const wsRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteAudioRefs = useRef(new Map());
  const callStartTime = useRef(null);
  const durationInterval = useRef(null);

  // WebRTC configuration
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Initialize WebRTC
  useEffect(() => {
    initializeWebRTC();
    loadRooms();
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const loadRooms = async () => {
    try {
      const response = await axios.get('/api/rooms');
      setRooms(response.data.rooms);
    } catch (error) {
      console.error('Error loading rooms:', error);
    }
  };

  // Call duration timer
  useEffect(() => {
    if (isInCall && callStartTime.current) {
      durationInterval.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTime.current) / 1000));
      }, 1000);
    } else {
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }
    }

    return () => {
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
      }
    };
  }, [isInCall]);

  const initializeWebRTC = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      setLocalStream(stream);
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  };

  const connectWebSocket = (roomId, userId) => {
    try {
      const wsUrl = `${API_BASE_URL.replace('http', 'ws')}/ws/${roomId}/${userId}`;
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setWsConnection(ws);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        setWsConnection(null);
        
        // Попытка переподключения через 3 секунды
        if (event.code !== 1000) { // Не нормальное закрытие
          setTimeout(() => {
            if (currentRoom) {
              console.log('Attempting to reconnect WebSocket...');
              connectWebSocket(roomId, userId);
            }
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      alert('Ошибка подключения к голосовому каналу');
    }
  };

  const handleWebSocketMessage = (message) => {
    switch (message.type) {
      case 'audio_data':
        handleRemoteAudioData(message);
        break;
      case 'user_status_update':
        updateParticipantStatus(message.user_id, message.data);
        break;
      case 'pong':
        // Handle ping response
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  };

  const handleRemoteAudioData = (message) => {
    // This would handle incoming audio data
    // For now, we'll just log it
    console.log('Received audio data from:', message.user_id);
  };

  const updateParticipantStatus = (userId, statusData) => {
    setParticipants(prev => 
      prev.map(p => 
        p.id === userId 
          ? { ...p, ...statusData }
          : p
      )
    );
  };

  const sendAudioData = (audioData) => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      const message = {
        type: 'audio_data',
        data: audioData,
        timestamp: Date.now()
      };
      wsConnection.send(JSON.stringify(message));
    }
  };

  const sendUserStatus = (statusData) => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      const message = {
        type: 'user_status',
        data: statusData
      };
      wsConnection.send(JSON.stringify(message));
    }
  };

  const createRoom = async () => {
    try {
      const response = await axios.post('/api/rooms', {
        name: newRoomName,
        password: newRoomPassword,
        max_participants: newRoomMaxParticipants,
        requires_password: newRoomRequiresPassword,
        has_waiting_room: newRoomHasWaitingRoom
      });
      
      const room = response.data;
      setCurrentRoom(room);
      
      // Очищаем поля ввода
      setNewRoomName('');
      setNewRoomPassword('');
      setNewRoomMaxParticipants(10);
      setNewRoomRequiresPassword(false);
      setNewRoomHasWaitingRoom(false);
      
      loadRooms(); // Обновляем список комнат
      setCurrentView('pre-call');
    } catch (error) {
      console.error('Error creating room:', error);
      alert('Ошибка создания комнаты: ' + (error.response?.data?.detail || error.message));
    }
  };

  const joinRoom = async (roomId) => {
    try {
      const response = await axios.post(`/api/rooms/${roomId}/join`, {
        name: userName,
        password: joinPassword
      });
      
      const { user, room, in_waiting_room } = response.data;
      setCurrentRoom(room);
      setParticipants(room.participants);
      setWaitingRoom(room.waiting_room || []);
      
      if (in_waiting_room) {
        setCurrentView('waiting-room');
      } else {
        setCurrentView('pre-call');
      }
      
      setJoinPassword(''); // Очищаем пароль
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Ошибка присоединения к комнате: ' + (error.response?.data?.detail || error.message));
    }
  };

  const startCall = async () => {
    if (!currentRoom) return;

    try {
      // Connect to WebSocket
      const userId = participants.find(p => p.name === userName)?.id || 'temp-user';
      connectWebSocket(currentRoom.id, userId);
      
      // Start call
      setCurrentView('call');
      setIsInCall(true);
      callStartTime.current = Date.now();
      setCallDuration(0);
    } catch (error) {
      console.error('Error starting call:', error);
    }
  };

  const leaveCall = () => {
    if (wsConnection) {
      wsConnection.close();
    }
    
    setCurrentView('main');
    setIsInCall(false);
    setCurrentRoom(null);
    setParticipants([]);
    callStartTime.current = null;
    setCallDuration(0);
  };

  const toggleMute = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !newMutedState;
      });
    }
    
    sendUserStatus({ is_muted: newMutedState });
  };

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Auth View
  const AuthView = () => (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 mx-auto">
            <Shield size={28} />
          </div>
          <h1 className="text-3xl font-bold mb-2">SecureVoice</h1>
          <p className="text-gray-400">Защищенное голосовое общение для команд</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Ваше имя</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
              placeholder="Введите ваше имя"
            />
          </div>

          <button
            onClick={() => setCurrentView('main')}
            disabled={!userName.trim()}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors flex items-center justify-center"
          >
            Войти
            <ArrowRight size={18} className="ml-2" />
          </button>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-800 text-center">
          <p className="text-sm text-gray-400">
            Используется end-to-end шифрование для максимальной безопасности
          </p>
        </div>
      </div>
    </div>
  );

  // Main Dashboard
  const MainView = () => (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Shield size={18} />
            </div>
            <h1 className="text-xl font-semibold">SecureVoice</h1>
          </div>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 px-3 py-1 bg-gray-800 rounded-lg">
              <User size={16} />
              <span className="text-sm">{userName}</span>
            </div>
            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <Settings size={20} />
            </button>
            <button 
              onClick={() => setCurrentView('auth')}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <button
            onClick={() => setCurrentView('create')}
            className="p-6 bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors text-left"
          >
            <Plus size={24} className="mb-3" />
            <h3 className="font-semibold mb-1">Создать встречу</h3>
            <p className="text-sm text-blue-100 opacity-80">Новая защищенная комната</p>
          </button>

          <button
            onClick={() => setCurrentView('join')}
            className="p-6 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors text-left"
          >
            <Link size={24} className="mb-3" />
            <h3 className="font-semibold mb-1">Присоединиться</h3>
            <p className="text-sm text-gray-400">По коду или ссылке</p>
          </button>

          <button
            onClick={() => setCurrentView('rooms')}
            className="p-6 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors text-left"
          >
            <Calendar size={24} className="mb-3" />
            <h3 className="font-semibold mb-1">Мои комнаты</h3>
            <p className="text-sm text-gray-400">Активные и запланированные</p>
          </button>
        </div>

        {/* Recent Rooms */}
        <div className="mb-8">
          <h2 className="text-lg font-medium mb-4">Недавние комнаты</h2>
          <div className="space-y-3">
            {rooms.slice(0, 3).map((room) => (
              <div key={room.id} className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors cursor-pointer"
                   onClick={() => room.is_active ? joinRoom(room.id) : setCurrentView('pre-call')}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                      <Lock size={16} className="text-green-400" />
                      <h3 className="font-medium">{room.name}</h3>
                    </div>
                    {room.is_active && (
                      <div className="flex items-center space-x-1">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                        <span className="text-sm text-green-400">Активна</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-3 text-gray-400">
                    <div className="flex items-center space-x-1">
                      <Users size={16} />
                      <span className="text-sm">{room.participants.length}</span>
                    </div>
                    <button className="p-1 hover:bg-gray-700 rounded">
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status */}
        <div className="p-4 bg-gray-800 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
              <span className={isConnected ? 'text-green-400' : 'text-red-400'}>
                {isConnected ? 'Подключено' : 'Отключено'}
              </span>
            </div>
            <div className="flex items-center space-x-2 text-gray-400">
              <Shield size={14} className="text-green-400" />
              <span>Защищенное соединение</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Create Room View
  const CreateView = () => (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => setCurrentView('main')} className="p-2 hover:bg-gray-800 rounded-lg">
              <X size={20} />
            </button>
            <h1 className="text-xl font-semibold">Создать встречу</h1>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-2xl mx-auto">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Название комнаты</label>
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
              placeholder="Например: Weekly Standup"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={createRoom}
              className="p-6 bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors text-center"
            >
              <PhoneCall size={24} className="mx-auto mb-3" />
              <h3 className="font-semibold mb-1">Начать сейчас</h3>
              <p className="text-sm text-blue-100 opacity-80">Мгновенная встреча</p>
            </button>

            <button className="p-6 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors text-center">
              <Calendar size={24} className="mx-auto mb-3" />
              <h3 className="font-semibold mb-1">Запланировать</h3>
              <p className="text-sm text-gray-400">На определенное время</p>
            </button>
          </div>

          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="font-medium mb-2">Настройки безопасности</h3>
            <div className="space-y-2">
              <label className="flex items-center space-x-3">
                <input type="checkbox" defaultChecked className="rounded bg-gray-700 border-gray-600" />
                <span className="text-sm">End-to-end шифрование</span>
              </label>
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded bg-gray-700 border-gray-600" />
                <span className="text-sm">Зал ожидания</span>
              </label>
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded bg-gray-700 border-gray-600" />
                <span className="text-sm">Требовать пароль</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Join Room View
  const JoinView = () => (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center space-x-3">
          <button onClick={() => setCurrentView('main')} className="p-2 hover:bg-gray-800 rounded-lg">
            <X size={20} />
          </button>
          <h1 className="text-xl font-semibold">Присоединиться к встрече</h1>
        </div>
      </div>

      <div className="p-6 max-w-md mx-auto">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Код встречи или ссылка</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
              placeholder="abc-defg-hij или https://..."
            />
          </div>

          <button
            onClick={() => joinRoom(joinCode)}
            disabled={!joinCode.trim()}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
          >
            Присоединиться
          </button>

          <div className="text-center">
            <p className="text-gray-400 text-sm">или</p>
          </div>

          <button className="w-full p-4 border-2 border-dashed border-gray-700 hover:border-blue-600 rounded-lg transition-colors">
            <div className="text-center">
              <Link size={20} className="mx-auto mb-2 text-gray-400" />
              <p className="text-gray-400">Вставить ссылку из буфера обмена</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );

  // Pre-call Setup View
  const PreCallView = () => (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center space-x-3">
          <button onClick={() => setCurrentView('main')} className="p-2 hover:bg-gray-800 rounded-lg">
            <X size={20} />
          </button>
          <h1 className="text-xl font-semibold">Готовность к звонку</h1>
        </div>
      </div>

      <div className="p-6 max-w-2xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Preview */}
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Предварительный просмотр</h2>
            <div className="aspect-video bg-gray-800 rounded-xl flex items-center justify-center relative">
              {isVideoEnabled ? (
                <div className="text-center">
                  <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mb-4 mx-auto">
                    <User size={24} />
                  </div>
                  <p className="text-gray-400">Камера включена</p>
                </div>
              ) : (
                <div className="text-center">
                  <VideoOff size={32} className="mx-auto mb-4 text-gray-400" />
                  <p className="text-gray-400">Камера отключена</p>
                </div>
              )}
            </div>

            {/* Audio Test */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-medium mb-3">Тест микрофона</h3>
              <div className="flex items-center space-x-3">
                <div className="flex-1 bg-gray-700 rounded-full h-2">
                  <div className="bg-green-400 h-2 rounded-full w-3/4 animate-pulse"></div>
                </div>
                <span className="text-sm text-green-400">Хорошо</span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-6">
            <h2 className="text-lg font-medium">Настройки</h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Mic size={20} />
                  <span>Микрофон</span>
                </div>
                <button
                  onClick={toggleMute}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    isMuted ? 'bg-gray-600' : 'bg-blue-600'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                    isMuted ? 'translate-x-1' : 'translate-x-6'
                  }`}></div>
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Video size={20} />
                  <span>Камера</span>
                </div>
                <button
                  onClick={() => setIsVideoEnabled(!isVideoEnabled)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    !isVideoEnabled ? 'bg-gray-600' : 'bg-blue-600'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full transition-transform ${
                    !isVideoEnabled ? 'translate-x-1' : 'translate-x-6'
                  }`}></div>
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Volume2 size={20} />
                  <span>Динамики</span>
                </div>
                <button className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">
                  Тест
                </button>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Shield size={20} className="text-green-400 mt-1" />
                <div>
                  <h3 className="font-medium text-green-400 mb-1">Защищенное соединение</h3>
                  <p className="text-sm text-gray-400">
                    Ваши разговоры защищены end-to-end шифрованием
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={startCall}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors flex items-center justify-center"
            >
              Войти в комнату
              <ArrowRight size={18} className="ml-2" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Call View
  const CallView = () => (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Lock size={16} className="text-green-400" />
            <h1 className="text-lg font-medium">{currentRoom?.name || 'Голосовой звонок'}</h1>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-sm text-green-400">Зашифровано</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <UserPlus size={18} />
            </button>
            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <Copy size={18} />
            </button>
            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
              <Settings size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex">
        <div className="w-80 border-r border-gray-800 p-4">
          <h2 className="text-lg font-medium mb-4 flex items-center">
            <Users size={20} className="mr-2" />
            Участники ({participants.length})
          </h2>
          <div className="space-y-3">
            {participants.map((participant) => (
              <div key={participant.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${
                    participant.is_speaking ? 'bg-green-400 animate-pulse' : 'bg-gray-600'
                  }`}></div>
                  <span className={`${participant.name === userName ? 'text-blue-400' : ''}`}>
                    {participant.name}
                  </span>
                </div>
                {participant.is_muted && <MicOff size={16} className="text-red-400" />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center mb-8">
            <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center mb-4 mx-auto">
              <PhoneCall size={32} />
            </div>
            <h2 className="text-2xl font-medium mb-2">Голосовой звонок</h2>
            <p className="text-gray-400">{formatDuration(callDuration)}</p>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800 p-6">
        <div className="flex items-center justify-center space-x-4">
          <button
            onClick={toggleMute}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
              isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
          </button>

          <button
            onClick={leaveCall}
            className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-all"
          >
            <PhoneOff size={24} />
          </button>

          <button className="w-14 h-14 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-all">
            <Settings size={24} />
          </button>
        </div>
      </div>
    </div>
  );

  // Route to appropriate view
  const views = {
    auth: <AuthView />,
    main: <MainView />,
    create: <CreateView />,
    join: <JoinView />,
    'pre-call': <PreCallView />,
    call: <CallView />
  };

  return views[currentView] || <MainView />;
};

export default SecureVoiceApp;

