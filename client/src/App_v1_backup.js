import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Mic, MicOff, PhoneCall, PhoneOff, Settings, Users, 
  Plus, Lock, Volume2, VolumeX, Shield, Minimize2,
  Maximize2, MoreVertical, UserPlus, Copy, LogOut,
  Calendar, Clock, Link, Video, VideoOff, User,
  ArrowRight, Check, X, RefreshCw, Share2, ExternalLink
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
  const [currentUser, setCurrentUser] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [waitingRoom, setWaitingRoom] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [joinPassword, setJoinPassword] = useState('');
  const [wsConnection, setWsConnection] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [isTestingMicrophone, setIsTestingMicrophone] = useState(false);

  const wsRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteAudioRefs = useRef(new Map());
  const callStartTime = useRef(null);
  const durationInterval = useRef(null);
  const audioContext = useRef(null);
  const analyser = useRef(null);
  const microphoneSource = useRef(null);
  const animationFrame = useRef(null);

  // WebRTC configuration
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Initialize WebRTC and load rooms
  useEffect(() => {
    initializeWebRTC();
    loadRooms();
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (audioContext.current) {
        audioContext.current.close();
      }
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
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

  // Microphone level monitoring
  const startMicrophoneMonitoring = useCallback((stream) => {
    try {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
      analyser.current = audioContext.current.createAnalyser();
      microphoneSource.current = audioContext.current.createMediaStreamSource(stream);
      
      analyser.current.fftSize = 256;
      microphoneSource.current.connect(analyser.current);
      
      const dataArray = new Uint8Array(analyser.current.frequencyBinCount);
      
      const updateLevel = () => {
        analyser.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((acc, value) => acc + value, 0) / dataArray.length;
        const level = Math.min(100, Math.max(0, (average / 255) * 100));
        setMicrophoneLevel(level);
        
        // Определяем, говорит ли пользователь
        const isSpeaking = level > 10;
        if (isSpeaking && currentUser) {
          setSpeakingUsers(prev => new Set(prev).add(currentUser.id));
          // Отправляем информацию о том, что говорим
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'speaking',
              user_id: currentUser.id,
              is_speaking: true
            }));
          }
        } else if (currentUser) {
          setSpeakingUsers(prev => {
            const newSet = new Set(prev);
            newSet.delete(currentUser.id);
            return newSet;
          });
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'speaking',
              user_id: currentUser.id,
              is_speaking: false
            }));
          }
        }
        
        animationFrame.current = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
    } catch (error) {
      console.error('Error setting up microphone monitoring:', error);
    }
  }, [currentUser]);

  const initializeWebRTC = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      setLocalStream(stream);
      startMicrophoneMonitoring(stream);
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
      alert('Ошибка доступа к микрофону. Проверьте разрешения.');
    }
  };

  const testMicrophone = useCallback(async () => {
    setIsTestingMicrophone(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startMicrophoneMonitoring(stream);
      
      // Тест в течение 5 секунд
      setTimeout(() => {
        setIsTestingMicrophone(false);
        stream.getTracks().forEach(track => track.stop());
      }, 5000);
    } catch (error) {
      console.error('Microphone test failed:', error);
      alert('Ошибка тестирования микрофона');
      setIsTestingMicrophone(false);
    }
  }, [startMicrophoneMonitoring]);

  const connectWebSocket = useCallback((roomId, userId) => {
    const wsUrl = `${API_BASE_URL.replace('http', 'ws')}/ws/${roomId}/${userId}`;
    console.log('Connecting to WebSocket:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      setWsConnection(ws);
      wsRef.current = ws;
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message:', data);
      
      switch (data.type) {
        case 'user_joined':
          setParticipants(prev => {
            const updated = [...prev];
            if (!updated.find(p => p.id === data.user.id)) {
              updated.push(data.user);
            }
            return updated;
          });
          break;
        case 'user_left':
          setParticipants(prev => prev.filter(p => p.id !== data.user_id));
          setSpeakingUsers(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.user_id);
            return newSet;
          });
          break;
        case 'speaking':
          if (data.is_speaking) {
            setSpeakingUsers(prev => new Set(prev).add(data.user_id));
          } else {
            setSpeakingUsers(prev => {
              const newSet = new Set(prev);
              newSet.delete(data.user_id);
              return newSet;
            });
          }
          break;
        case 'participants_update':
          setParticipants(data.participants || []);
          break;
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      setWsConnection(null);
      wsRef.current = null;
      
      // Попытка переподключения через 3 секунды
      setTimeout(() => {
        if (currentRoom && currentUser) {
          connectWebSocket(roomId, userId);
        }
      }, 3000);
    };
  }, [API_BASE_URL, currentRoom, currentUser]);

  const createRoom = async () => {
    if (!newRoomName.trim()) {
      alert('Введите название комнаты');
      return;
    }

    try {
      const response = await axios.post('/api/rooms', {
        name: newRoomName,
        password: newRoomPassword,
        max_participants: newRoomMaxParticipants,
        requires_password: newRoomRequiresPassword,
        has_waiting_room: newRoomHasWaitingRoom
      });

      const { room_id, room } = response.data;
      
      // Автоматически присоединяемся к созданной комнате
      const joinResponse = await axios.post(`/api/rooms/${room_id}/join`, {
        name: userName,
        password: newRoomPassword
      });
      
      const { user, room: joinedRoom, in_waiting_room } = joinResponse.data;
      
      setCurrentUser(user);
      setCurrentRoom(joinedRoom);
      setParticipants(joinedRoom.participants || []);
      
      // Подключаемся к WebSocket
      connectWebSocket(room_id, user.id);
      
      // Очищаем поля
      setNewRoomName('');
      setNewRoomPassword('');
      setNewRoomRequiresPassword(false);
      setNewRoomHasWaitingRoom(false);
      
      // Обновляем список комнат
      loadRooms();
      
      if (in_waiting_room) {
        setCurrentView('waiting-room');
      } else {
        setCurrentView('pre-call');
      }
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
      
      setCurrentUser(user);
      setCurrentRoom(room);
      setParticipants(room.participants || []);
      
      // Подключаемся к WebSocket
      connectWebSocket(roomId, user.id);
      
      if (in_waiting_room) {
        setCurrentView('waiting-room');
      } else {
        setCurrentView('pre-call');
      }
      
      setJoinPassword('');
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Ошибка присоединения к комнате: ' + (error.response?.data?.detail || error.message));
    }
  };

  const copyRoomLink = useCallback(() => {
    if (currentRoom) {
      const roomLink = `${window.location.origin}?room=${currentRoom.id}`;
      navigator.clipboard.writeText(roomLink).then(() => {
        alert('Ссылка на комнату скопирована!');
      }).catch(() => {
        // Fallback для старых браузеров
        const textArea = document.createElement('textarea');
        textArea.value = roomLink;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Ссылка на комнату скопирована!');
      });
    }
  }, [currentRoom]);

  const shareRoom = useCallback(() => {
    if (currentRoom && navigator.share) {
      const roomLink = `${window.location.origin}?room=${currentRoom.id}`;
      navigator.share({
        title: `Присоединиться к ${currentRoom.name}`,
        text: `Приглашение на голосовую встречу в SecureVoice`,
        url: roomLink
      }).catch(console.error);
    } else {
      copyRoomLink();
    }
  }, [currentRoom, copyRoomLink]);

  const startCall = () => {
    setIsInCall(true);
    callStartTime.current = Date.now();
    setCurrentView('call');
  };

  const endCall = () => {
    setIsInCall(false);
    callStartTime.current = null;
    setCallDuration(0);
    if (wsConnection) {
      wsConnection.close();
    }
    setCurrentView('main');
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Check for room parameter in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (roomId && currentView === 'auth') {
      setJoinCode(roomId);
      setCurrentView('join');
    }
  }, [currentView]);

  // Auth View
  const AuthView = () => (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-md border border-gray-700">
        <div className="text-center mb-8">
          <div className="bg-blue-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Mic size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">SecureVoice</h1>
          <p className="text-gray-400">Защищенное голосовое общение</p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-white">Ваше имя</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 text-white placeholder-gray-400"
              placeholder="Введите ваше имя"
              autoFocus
            />
          </div>

          {/* Microphone Test */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-white">Тест микрофона</label>
              <button
                onClick={testMicrophone}
                disabled={isTestingMicrophone}
                className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {isTestingMicrophone ? 'Тестирую...' : 'Тест'}
              </button>
            </div>
            
            {/* Microphone Level Indicator */}
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-green-400 to-green-600 h-2 rounded-full transition-all duration-100"
                style={{ width: `${microphoneLevel}%` }}
              ></div>
            </div>
            <p className="text-xs text-gray-400">
              {microphoneLevel > 10 ? '🎤 Микрофон работает!' : '🔇 Говорите в микрофон'}
            </p>
          </div>

          <button
            onClick={() => userName.trim() && setCurrentView('main')}
            disabled={!userName.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );

  // Main Dashboard View
  const MainView = () => (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 w-10 h-10 rounded-lg flex items-center justify-center">
              <Mic size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">SecureVoice</h1>
              <p className="text-sm text-gray-400">Привет, {userName}!</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button className="p-2 hover:bg-gray-800 rounded-lg">
              <Settings size={20} />
            </button>
            <button 
              onClick={() => setCurrentView('auth')}
              className="p-2 hover:bg-gray-800 rounded-lg"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Максимум участников</label>
              <select 
                value={newRoomMaxParticipants}
                onChange={(e) => setNewRoomMaxParticipants(parseInt(e.target.value))}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value={5}>5 участников</option>
                <option value={10}>10 участников</option>
                <option value={25}>25 участников</option>
                <option value={50}>50 участников</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Пароль (опционально)</label>
              <input
                type="password"
                value={newRoomPassword}
                onChange={(e) => setNewRoomPassword(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="Введите пароль"
              />
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="font-medium mb-3">Настройки безопасности</h3>
            <div className="space-y-2">
              <label className="flex items-center space-x-3">
                <input 
                  type="checkbox" 
                  checked={newRoomRequiresPassword} 
                  onChange={(e) => setNewRoomRequiresPassword(e.target.checked)}
                  className="rounded bg-gray-700 border-gray-600" 
                />
                <span className="text-sm">Требовать пароль для входа</span>
              </label>
              <label className="flex items-center space-x-3">
                <input 
                  type="checkbox"
                  checked={newRoomHasWaitingRoom}
                  onChange={(e) => setNewRoomHasWaitingRoom(e.target.checked)}
                  className="rounded bg-gray-700 border-gray-600" 
                />
                <span className="text-sm">Зал ожидания</span>
              </label>
            </div>
          </div>

          <button
            onClick={createRoom}
            disabled={!newRoomName.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Создать встречу
          </button>
        </div>
      </div>
    </div>
  );

  // Join Room View
  const JoinView = () => (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => setCurrentView('main')} className="p-2 hover:bg-gray-800 rounded-lg">
              <X size={20} />
            </button>
            <h1 className="text-xl font-semibold">Присоединиться к встрече</h1>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-2xl mx-auto">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Код встречи или ссылка</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
              placeholder="Введите код комнаты"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Пароль (если требуется)</label>
            <input
              type="password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
              placeholder="Введите пароль"
            />
          </div>

          <button
            onClick={() => joinRoom(joinCode)}
            disabled={!joinCode.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Присоединиться
          </button>
        </div>
      </div>
    </div>
  );

  // Pre-call setup view
  const PreCallView = () => (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => setCurrentView('main')} className="p-2 hover:bg-gray-800 rounded-lg">
              <X size={20} />
            </button>
            <div>
              <h1 className="text-xl font-semibold">{currentRoom?.name || 'Комната'}</h1>
              <p className="text-sm text-gray-400">
                Участников: {participants.length}/{currentRoom?.max_participants}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={shareRoom}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <Share2 size={16} />
              <span>Поделиться</span>
            </button>
            <button
              onClick={copyRoomLink}
              className="p-2 hover:bg-gray-800 rounded-lg"
              title="Копировать ссылку"
            >
              <Copy size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto">
        {/* Microphone Test Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="font-medium mb-4">Проверка устройств</h3>
          
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Микрофон</label>
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${microphoneLevel > 10 ? 'bg-green-400' : 'bg-gray-400'}`}></div>
                  <span className="text-sm text-gray-400">
                    {microphoneLevel > 10 ? 'Активен' : 'Тишина'}
                  </span>
                </div>
              </div>
              
              {/* Real-time microphone level */}
              <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                <div 
                  className={`h-3 rounded-full transition-all duration-100 ${
                    microphoneLevel > 50 ? 'bg-gradient-to-r from-yellow-400 to-red-500' :
                    microphoneLevel > 20 ? 'bg-gradient-to-r from-green-400 to-yellow-400' :
                    'bg-gradient-to-r from-green-400 to-green-500'
                  }`}
                  style={{ width: `${Math.min(microphoneLevel, 100)}%` }}
                ></div>
              </div>
              
              <p className="text-xs text-gray-400 mt-1">
                {microphoneLevel > 30 ? '🎤 Отличный уровень!' : 
                 microphoneLevel > 10 ? '🎤 Хороший уровень' : 
                 '🔇 Попробуйте говорить громче'}
              </p>
            </div>

            <div className="flex items-center space-x-4">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                  isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                <span>{isMuted ? 'Микрофон выключен' : 'Микрофон включен'}</span>
              </button>

              <button
                onClick={() => setIsSpeakerMuted(!isSpeakerMuted)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                  isSpeakerMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {isSpeakerMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                <span>{isSpeakerMuted ? 'Звук выключен' : 'Звук включен'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Participants */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="font-medium mb-4">Участники ({participants.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {participants.map((participant) => (
              <div 
                key={participant.id} 
                className={`flex items-center space-x-3 p-3 rounded-lg transition-all ${
                  speakingUsers.has(participant.id) 
                    ? 'bg-green-600 bg-opacity-20 border-2 border-green-400' 
                    : 'bg-gray-700'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  speakingUsers.has(participant.id) ? 'bg-green-500' : 'bg-blue-600'
                }`}>
                  <User size={20} />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{participant.name}</p>
                  <p className="text-xs text-gray-400">
                    {participant.id === currentUser?.id ? 'Вы' : 'Участник'}
                    {speakingUsers.has(participant.id) && ' • Говорит'}
                  </p>
                </div>
                {speakingUsers.has(participant.id) && (
                  <div className="flex space-x-1">
                    <div className="w-1 h-4 bg-green-400 rounded animate-pulse"></div>
                    <div className="w-1 h-4 bg-green-400 rounded animate-pulse" style={{animationDelay: '0.1s'}}></div>
                    <div className="w-1 h-4 bg-green-400 rounded animate-pulse" style={{animationDelay: '0.2s'}}></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Join Call Button */}
        <button
          onClick={startCall}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-4 px-6 rounded-lg transition-colors flex items-center justify-center space-x-2"
        >
          <PhoneCall size={20} />
          <span>Присоединиться к звонку</span>
        </button>
      </div>
    </div>
  );

  // Call View
  const CallView = () => (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div>
              <h1 className="text-xl font-semibold">{currentRoom?.name || 'Звонок'}</h1>
              <p className="text-sm text-gray-400">
                {formatDuration(callDuration)} • {participants.length} участников
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={shareRoom}
              className="flex items-center space-x-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              <UserPlus size={16} />
              <span>Пригласить</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col p-6">
        {/* Participants Grid */}
        <div className="flex-1 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 h-full">
            {participants.map((participant) => (
              <div 
                key={participant.id} 
                className={`bg-gray-800 rounded-lg p-6 flex flex-col items-center justify-center transition-all ${
                  speakingUsers.has(participant.id) 
                    ? 'ring-4 ring-green-400 bg-green-900 bg-opacity-30' 
                    : ''
                }`}
              >
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 transition-all ${
                  speakingUsers.has(participant.id) 
                    ? 'bg-green-500 animate-pulse' 
                    : 'bg-blue-600'
                }`}>
                  <User size={32} />
                </div>
                <h3 className="font-medium text-center">{participant.name}</h3>
                <p className="text-sm text-gray-400 text-center">
                  {participant.id === currentUser?.id ? 'Вы' : 'Участник'}
                </p>
                {speakingUsers.has(participant.id) && (
                  <div className="flex space-x-1 mt-2">
                    <div className="w-1 h-6 bg-green-400 rounded animate-bounce"></div>
                    <div className="w-1 h-6 bg-green-400 rounded animate-bounce" style={{animationDelay: '0.1s'}}></div>
                    <div className="w-1 h-6 bg-green-400 rounded animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    <div className="w-1 h-6 bg-green-400 rounded animate-bounce" style={{animationDelay: '0.3s'}}></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center space-x-4">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          <button
            onClick={endCall}
            className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors"
          >
            <PhoneOff size={20} />
          </button>

          <button
            onClick={() => setIsSpeakerMuted(!isSpeakerMuted)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isSpeakerMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {isSpeakerMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>

          <button
            onClick={shareRoom}
            className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center transition-colors"
          >
            <UserPlus size={20} />
          </button>
        </div>

        {/* Microphone Level Indicator */}
        <div className="mt-4 flex justify-center">
          <div className="w-64">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">Ваш микрофон</span>
              <span className="text-xs text-gray-400">
                {microphoneLevel > 10 ? 'Активен' : 'Тишина'}
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-100 ${
                  microphoneLevel > 50 ? 'bg-gradient-to-r from-yellow-400 to-red-500' :
                  microphoneLevel > 20 ? 'bg-gradient-to-r from-green-400 to-yellow-400' :
                  'bg-gradient-to-r from-green-400 to-green-500'
                }`}
                style={{ width: `${Math.min(microphoneLevel, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Waiting Room View
  const WaitingRoomView = () => (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full mx-4">
        <div className="text-center">
          <div className="bg-yellow-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Clock size={32} />
          </div>
          <h2 className="text-2xl font-bold mb-2">Зал ожидания</h2>
          <p className="text-gray-400 mb-6">
            Вы находитесь в зале ожидания. Ожидайте подтверждения от организатора встречи.
          </p>
          <div className="bg-gray-700 rounded-lg p-4 mb-6">
            <h3 className="font-medium mb-2">{currentRoom?.name}</h3>
            <p className="text-sm text-gray-400">
              Участников в комнате: {participants.length}/{currentRoom?.max_participants}
            </p>
          </div>
          <button
            onClick={() => setCurrentView('main')}
            className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Вернуться на главную
          </button>
        </div>
      </div>
    </div>
  );

  // Render current view
  const renderCurrentView = () => {
    switch (currentView) {
      case 'auth':
        return <AuthView />;
      case 'main':
        return <MainView />;
      case 'create':
        return <CreateView />;
      case 'join':
        return <JoinView />;
      case 'pre-call':
        return <PreCallView />;
      case 'call':
        return <CallView />;
      case 'waiting-room':
        return <WaitingRoomView />;
      default:
        return <AuthView />;
    }
  };

  return renderCurrentView();
};

export default SecureVoiceApp;
