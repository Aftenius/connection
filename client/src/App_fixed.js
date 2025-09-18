import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Mic, MicOff, PhoneCall, PhoneOff, Settings, Users, 
  Plus, Lock, Volume2, VolumeX, Shield,
  UserPlus, Copy, LogOut, Calendar, Clock, Link, User,
  X, Share2, Trash2, Crown, AlertCircle, Bell,
  VolumeOff, Volume1
} from 'lucide-react';
import SessionManager from './SessionManager';
import JoinRequestPopup from './JoinRequestPopup';

// Настройка базового URL для API
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Цветовая схема с зеленым акцентом
const THEME_COLORS = {
  primary: '#70BD1F',
  primaryHover: '#5fa318',
  primaryLight: '#70BD1F30',
  speaking: '#70BD1F',
  speakingGlow: '#70BD1F80'
};

const SecureVoiceApp = () => {
  // Основные состояния
  const [currentView, setCurrentView] = useState('auth');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [isAllMuted, setIsAllMuted] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  
  // Данные пользователя и сессии
  const [userName, setUserName] = useState('');
  const [sessionManager] = useState(() => new SessionManager());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  
  // Комнаты и участники
  const [joinCode, setJoinCode] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomMaxParticipants, setNewRoomMaxParticipants] = useState(10);
  const [newRoomRequiresPassword, setNewRoomRequiresPassword] = useState(false);
  const [newRoomHasWaitingRoom, setNewRoomHasWaitingRoom] = useState(true);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [userRooms, setUserRooms] = useState([]);
  const [joinPassword, setJoinPassword] = useState('');
  
  // WebSocket и соединение
  const [wsConnection, setWsConnection] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  
  // Звук и анимации
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [isTestingMicrophone, setIsTestingMicrophone] = useState(false);
  const [participantVolumes, setParticipantVolumes] = useState(new Map());
  
  // Запросы на подключение
  const [joinRequests, setJoinRequests] = useState([]);
  const [showRequestsPopup, setShowRequestsPopup] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  // Refs
  const wsRef = useRef(null);
  const localVideoRef = useRef(null);
  const callStartTime = useRef(null);
  const durationInterval = useRef(null);
  const audioContext = useRef(null);
  const analyser = useRef(null);
  const microphoneSource = useRef(null);
  const animationFrame = useRef(null);

  // Инициализация при загрузке
  useEffect(() => {
    const initializeApp = async () => {
      console.log('🚀 Инициализация приложения...');
      
      // Проверяем сохраненную сессию
      const savedName = sessionManager.getSavedUserName();
      console.log('📝 Сохраненное имя:', savedName);
      
      if (savedName) {
        setUserName(savedName);
        
        // Пытаемся автоматически восстановить сессию
        try {
          console.log('🔄 Попытка восстановления сессии...');
          const sessionData = await sessionManager.createOrRestoreSession(savedName, API_BASE_URL);
          
          if (sessionData && sessionData.user) {
            console.log('✅ Сессия восстановлена:', sessionData.user);
            setCurrentUser(sessionData.user);
            setIsAuthenticated(true);
            setCurrentView('main');
            
            // Загружаем комнаты пользователя
            await loadUserRooms();
          }
        } catch (error) {
          console.error('❌ Ошибка восстановления сессии:', error);
          // Остаемся на странице auth
        }
      }

      await loadRooms();

      // Проверяем URL параметры для автоматического присоединения
      const urlParams = new URLSearchParams(window.location.search);
      const roomId = urlParams.get('room');
      if (roomId) {
        setJoinCode(roomId);
        if (savedName && isAuthenticated) {
          setCurrentView('join');
        }
      }
    };

    initializeApp();
    
    return () => {
      cleanup();
    };
  }, []); // Убираем зависимости, чтобы запускалось только один раз

  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (audioContext.current) {
      audioContext.current.close();
    }
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
    }
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
    }
  };

  // Создание или восстановление сессии
  const authenticateUser = async (name) => {
    try {
      console.log('🔐 Аутентификация пользователя:', name);
      const sessionData = await sessionManager.createOrRestoreSession(name, API_BASE_URL);
      console.log('✅ Сессия создана/восстановлена:', sessionData);
      
      setCurrentUser(sessionData.user);
      setIsAuthenticated(true);
      setUserName(sessionData.user.name);
      
      // Загружаем комнаты пользователя
      await loadUserRooms();
      
      return sessionData;
    } catch (error) {
      console.error('❌ Ошибка аутентификации:', error);
      alert('Ошибка создания сессии: ' + error.message);
      throw error;
    }
  };

  // Инициализация микрофона только в комнате
  const initializeMicrophoneForRoom = useCallback(async () => {
    if (currentView !== 'pre-call' && currentView !== 'call') {
      return;
    }

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
      console.error('Ошибка доступа к устройствам:', error);
      alert('Ошибка доступа к микрофону. Проверьте разрешения.');
    }
  }, [currentView]);

  // Активация микрофона при входе в комнату
  useEffect(() => {
    if (currentView === 'pre-call' || currentView === 'call') {
      initializeMicrophoneForRoom();
    } else {
      // Отключаем микрофон при выходе из комнаты
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        setLocalStream(null);
      }
    }
  }, [currentView, initializeMicrophoneForRoom]);

  // Загрузка комнат пользователя
  const loadUserRooms = async () => {
    if (!sessionManager.isAuthenticated()) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/user/rooms`, {
        headers: sessionManager.getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        setUserRooms(data.rooms);
      }
    } catch (error) {
      console.error('Ошибка загрузки комнат пользователя:', error);
    }
  };

  // Загрузка всех комнат
  const loadRooms = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms`);
      if (response.ok) {
        const data = await response.json();
        setRooms(data.rooms);
      }
    } catch (error) {
      console.error('Ошибка загрузки комнат:', error);
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
  }, [isInCall]);

  // Мониторинг микрофона
  const startMicrophoneMonitoring = useCallback((stream) => {
    try {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
      analyser.current = audioContext.current.createAnalyser();
      microphoneSource.current = audioContext.current.createMediaStreamSource(stream);
      
      analyser.current.fftSize = 256;
      microphoneSource.current.connect(analyser.current);
      
      const dataArray = new Uint8Array(analyser.current.frequencyBinCount);
      
      const updateLevel = () => {
        if (!analyser.current) return;
        
        analyser.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((acc, value) => acc + value, 0) / dataArray.length;
        const level = Math.min(100, Math.max(0, (average / 255) * 100));
        setMicrophoneLevel(level);
        
        // Определяем, говорит ли пользователь (только если не заглушен)
        const isSpeaking = level > 10 && !isMuted && !isAllMuted;
        if (isSpeaking && currentUser) {
          setSpeakingUsers(prev => new Set(prev).add(currentUser.user_id));
          // Отправляем информацию о том, что говорим
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'speaking',
              user_id: currentUser.user_id,
              is_speaking: true
            }));
          }
        } else if (currentUser) {
          setSpeakingUsers(prev => {
            const newSet = new Set(prev);
            newSet.delete(currentUser.user_id);
            return newSet;
          });
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'speaking',
              user_id: currentUser.user_id,
              is_speaking: false
            }));
          }
        }
        
        animationFrame.current = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
    } catch (error) {
      console.error('Ошибка настройки мониторинга микрофона:', error);
    }
  }, [currentUser, isMuted, isAllMuted]);

  const testMicrophone = useCallback(async () => {
    setIsTestingMicrophone(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startMicrophoneMonitoring(stream);
      
      setTimeout(() => {
        setIsTestingMicrophone(false);
        stream.getTracks().forEach(track => track.stop());
      }, 5000);
    } catch (error) {
      console.error('Ошибка тестирования микрофона:', error);
      alert('Ошибка тестирования микрофона');
      setIsTestingMicrophone(false);
    }
  }, [startMicrophoneMonitoring]);

  // Управление звуком
  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = isMuted;
      });
    }
  };

  const toggleSpeaker = () => {
    setIsSpeakerMuted(!isSpeakerMuted);
  };

  const toggleAllMute = () => {
    const newAllMuted = !isAllMuted;
    setIsAllMuted(newAllMuted);
    
    if (newAllMuted) {
      setIsMuted(true);
      setIsSpeakerMuted(true);
      if (localStream) {
        localStream.getAudioTracks().forEach(track => {
          track.enabled = false;
        });
      }
    } else {
      setIsMuted(false);
      setIsSpeakerMuted(false);
      if (localStream) {
        localStream.getAudioTracks().forEach(track => {
          track.enabled = true;
        });
      }
    }
  };

  // Регулировка громкости участника
  const setParticipantVolume = (participantId, volume) => {
    setParticipantVolumes(prev => {
      const newMap = new Map(prev);
      newMap.set(participantId, volume);
      return newMap;
    });
  };

  // WebSocket соединение
  const connectWebSocket = useCallback((roomId, userId) => {
    const wsUrl = `${API_BASE_URL.replace('http', 'ws')}/ws/${roomId}/${userId}`;
    console.log('Подключение к WebSocket:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket подключен');
      setIsConnected(true);
      setWsConnection(ws);
      wsRef.current = ws;
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket сообщение:', data);
      
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
          
        case 'join_request':
          setJoinRequests(prev => {
            const updated = [...prev];
            if (!updated.find(r => r.user.id === data.user.id)) {
              updated.push({
                user: data.user,
                requested_at: Date.now() / 1000
              });
            }
            return updated;
          });
          setShowRequestsPopup(true);
          break;
          
        case 'join_approved':
          if (data.user.id === currentUser?.user_id) {
            setAwaitingApproval(false);
            setCurrentView('pre-call');
          }
          break;
          
        case 'join_rejected':
          if (data.user_id === currentUser?.user_id) {
            setAwaitingApproval(false);
            alert('Ваш запрос на подключение был отклонен');
            setCurrentView('main');
          }
          break;
          
        case 'room_deleted':
          alert('Комната была удалена создателем');
          setCurrentView('main');
          break;
          
        case 'participants_update':
          setParticipants(data.participants || []);
          break;

        default:
          break;
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket ошибка:', error);
      setIsConnected(false);
    };
    
    ws.onclose = () => {
      console.log('WebSocket отключен');
      setIsConnected(false);
      setWsConnection(null);
      wsRef.current = null;
      
      if (currentRoom && currentUser) {
        setTimeout(() => {
          connectWebSocket(roomId, userId);
        }, 3000);
      }
    };
  }, [currentRoom, currentUser]);

  // Проверка существования комнаты
  const checkRoomExists = async (roomId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId}`);
      return response.ok;
    } catch (error) {
      return false;
    }
  };

  // Создание комнаты
  const createRoom = async () => {
    if (!newRoomName.trim()) {
      alert('Введите название комнаты');
      return;
    }

    if (!isAuthenticated) {
      alert('Сначала войдите в систему');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms`, {
        method: 'POST',
        headers: sessionManager.getAuthHeaders(),
        body: JSON.stringify({
          name: newRoomName,
          password: newRoomPassword,
          max_participants: newRoomMaxParticipants,
          requires_password: newRoomRequiresPassword,
          has_waiting_room: newRoomHasWaitingRoom
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Ошибка создания комнаты');
      }

      const data = await response.json();
      
      setCurrentRoom(data.room);
      setCurrentUser(data.user);
      setParticipants([data.user]);
      
      connectWebSocket(data.room_id, data.user.id);
      
      setNewRoomName('');
      setNewRoomPassword('');
      setNewRoomRequiresPassword(false);
      setNewRoomHasWaitingRoom(true);
      
      await loadRooms();
      await loadUserRooms();
      
      setCurrentView('pre-call');
      
    } catch (error) {
      console.error('Ошибка создания комнаты:', error);
      alert('Ошибка создания комнаты: ' + error.message);
    }
  };

  // Присоединение к комнате
  const joinRoom = async (roomId) => {
    if (!isAuthenticated) {
      alert('Сначала войдите в систему');
      return;
    }

    const roomExists = await checkRoomExists(roomId);
    if (!roomExists) {
      alert('Увы, комната больше не существует 😔');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: sessionManager.getAuthHeaders(),
        body: JSON.stringify({
          name: currentUser.name,
          password: joinPassword,
          session_token: sessionManager.getSessionToken()
        })
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 401 && joinPassword) {
          throw new Error('Неверный пароль');
        }
        throw new Error(error.detail || 'Ошибка присоединения');
      }

      const data = await response.json();
      
      setCurrentRoom(data.room);
      setCurrentUser(data.user);
      setParticipants(data.room.participants || []);
      
      if (data.awaiting_approval) {
        setAwaitingApproval(true);
        setCurrentView('waiting-approval');
        connectWebSocket(roomId, data.user.id);
      } else if (data.in_waiting_room) {
        setCurrentView('waiting-room');
        connectWebSocket(roomId, data.user.id);
      } else {
        setCurrentView('pre-call');
        connectWebSocket(roomId, data.user.id);
      }
      
      setJoinPassword('');
      
    } catch (error) {
      console.error('Ошибка присоединения:', error);
      alert('Ошибка присоединения: ' + error.message);
    }
  };

  // Одобрение пользователя
  const approveUser = async (userId) => {
    if (!currentRoom || !currentUser?.is_creator) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${currentRoom.id}/approve`, {
        method: 'POST',
        headers: sessionManager.getAuthHeaders(),
        body: JSON.stringify({ user_id: userId })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Ошибка одобрения');
      }

      setJoinRequests(prev => prev.filter(req => req.user.id !== userId));
      
    } catch (error) {
      console.error('Ошибка одобрения:', error);
      alert('Ошибка одобрения: ' + error.message);
    }
  };

  // Отклонение пользователя
  const rejectUser = async (userId) => {
    if (!currentRoom || !currentUser?.is_creator) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${currentRoom.id}/reject`, {
        method: 'POST',
        headers: sessionManager.getAuthHeaders(),
        body: JSON.stringify({ user_id: userId })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Ошибка отклонения');
      }

      setJoinRequests(prev => prev.filter(req => req.user.id !== userId));
      
    } catch (error) {
      console.error('Ошибка отклонения:', error);
      alert('Ошибка отклонения: ' + error.message);
    }
  };

  // Удаление комнаты
  const deleteRoom = async (roomId) => {
    // eslint-disable-next-line no-restricted-globals
    if (!window.confirm('Вы уверены, что хотите удалить эту комнату?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId}`, {
        method: 'DELETE',
        headers: sessionManager.getAuthHeaders()
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Ошибка удаления');
      }

      await loadRooms();
      await loadUserRooms();
      
      alert('Комната успешно удалена');
      
    } catch (error) {
      console.error('Ошибка удаления комнаты:', error);
      alert('Ошибка удаления: ' + error.message);
    }
  };

  // Копирование ссылки на комнату
  const copyRoomLink = useCallback(() => {
    if (currentRoom) {
      const roomLink = `${window.location.origin}?room=${currentRoom.id}`;
      navigator.clipboard.writeText(roomLink).then(() => {
        alert('Ссылка на комнату скопирована!');
      }).catch(() => {
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

  // Поделиться комнатой
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

  const logout = () => {
    sessionManager.clearSession();
    setIsAuthenticated(false);
    setCurrentUser(null);
    setUserName('');
    setCurrentView('auth');
    if (wsConnection) {
      wsConnection.close();
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Компонент карточки участника с внутренней анимацией
  const ParticipantCard = ({ participant, isSpeaking, showVolumeControl = false }) => {
    const volume = participantVolumes.get(participant.id) || 100;
    
    return (
      <div className="bg-gray-800 rounded-lg p-4 relative overflow-hidden">
        {/* Фоновая анимация говорящего */}
        {isSpeaking && (
          <div 
            className="absolute inset-0 rounded-lg opacity-20 animate-pulse"
            style={{ 
              background: `linear-gradient(45deg, ${THEME_COLORS.speaking}40, ${THEME_COLORS.speaking}80)`,
              animation: 'speakingGlow 1s ease-in-out infinite alternate'
            }}
          />
        )}
        
        {/* Контент карточки */}
        <div className="relative z-10 flex items-center space-x-3">
          <div 
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
              isSpeaking 
                ? `bg-gradient-to-br from-green-400 to-green-600 shadow-lg` 
                : participant.is_creator ? 'bg-yellow-600' : 'bg-blue-600'
            }`}
            style={isSpeaking ? { 
              boxShadow: `0 0 20px ${THEME_COLORS.speakingGlow}`,
              transform: 'scale(1.05)'
            } : {}}
          >
            {participant.is_creator ? <Crown size={20} /> : <User size={20} />}
          </div>
          
          <div className="flex-1">
            <p className="font-medium text-white">{participant.name}</p>
            <div className="flex items-center space-x-2 text-xs">
              <span className="text-gray-400">
                {participant.is_creator ? 'Создатель' : 'Участник'}
                {participant.id === currentUser?.user_id && ' (Вы)'}
              </span>
              
              <div className="flex items-center space-x-1">
                {participant.is_muted && <MicOff size={12} className="text-red-400" />}
                {participant.speaker_muted && <VolumeX size={12} className="text-red-400" />}
                {isSpeaking && (
                  <span 
                    className="text-xs font-medium animate-pulse"
                    style={{ color: THEME_COLORS.speaking }}
                  >
                    Говорит
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Анимированные полоски звука */}
          {isSpeaking && (
            <div className="flex items-center space-x-1">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full"
                  style={{
                    height: '16px',
                    backgroundColor: THEME_COLORS.speaking,
                    animation: `soundBars 0.6s ease-in-out infinite alternate`,
                    animationDelay: `${i * 0.1}s`
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Контроль громкости */}
        {showVolumeControl && participant.id !== currentUser?.user_id && (
          <div className="mt-3 opacity-75 hover:opacity-100 transition-opacity">
            <div className="flex items-center space-x-2">
              <Volume1 size={14} className="text-gray-400" />
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setParticipantVolume(participant.id, parseInt(e.target.value))}
                className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none slider"
                style={{
                  background: `linear-gradient(to right, ${THEME_COLORS.primary} 0%, ${THEME_COLORS.primary} ${volume}%, #374151 ${volume}%, #374151 100%)`
                }}
              />
              <span className="text-xs text-gray-400 w-8">{volume}%</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Auth View
  const AuthView = () => (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <style jsx>{`
        @keyframes speakingGlow {
          0% { opacity: 0.1; }
          100% { opacity: 0.3; }
        }
        
        @keyframes soundBars {
          0% { height: 8px; }
          100% { height: 20px; }
        }
        
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: ${THEME_COLORS.primary};
          cursor: pointer;
        }
        
        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: ${THEME_COLORS.primary};
          cursor: pointer;
          border: none;
        }
      `}</style>
      
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-md border border-gray-700">
        <div className="text-center mb-8">
          <div 
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: THEME_COLORS.primary }}
          >
            <Mic size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">SecureVoice</h1>
          <p className="text-gray-400">Защищенное голосовое общение v3</p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-white">Ваше имя</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none text-white placeholder-gray-400 focus:border-green-500"
              style={{ borderColor: userName.trim() ? THEME_COLORS.primary : '' }}
              placeholder="Введите ваше имя"
              autoFocus
            />
            {sessionManager.hasSavedSession() && (
              <p className="text-xs mt-1" style={{ color: THEME_COLORS.primary }}>
                ✓ Найдена сохраненная сессия
              </p>
            )}
          </div>

          {/* Microphone Test */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-white">Тест микрофона</label>
              <button
                onClick={testMicrophone}
                disabled={isTestingMicrophone}
                className="px-3 py-1 text-white rounded text-sm transition-colors disabled:opacity-50"
                style={{ 
                  backgroundColor: THEME_COLORS.primary,
                  ':hover': { backgroundColor: THEME_COLORS.primaryHover }
                }}
              >
                {isTestingMicrophone ? 'Тестирую...' : 'Тест'}
              </button>
            </div>
            
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="h-2 rounded-full transition-all duration-100"
                style={{ 
                  width: `${microphoneLevel}%`,
                  background: `linear-gradient(to right, ${THEME_COLORS.primary}, #22c55e)`
                }}
              ></div>
            </div>
            <p className="text-xs text-gray-400">
              {microphoneLevel > 10 ? '🎤 Микрофон работает!' : '🔇 Говорите в микрофон'}
            </p>
          </div>

          <button
            onClick={async () => {
              if (userName.trim()) {
                try {
                  await authenticateUser(userName.trim());
                  setCurrentView('main');
                } catch (error) {
                  // Ошибка уже обработана в authenticateUser
                }
              }
            }}
            disabled={!userName.trim()}
            className="w-full text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:bg-gray-600"
            style={{ 
              backgroundColor: userName.trim() ? THEME_COLORS.primary : '',
              ':hover': { backgroundColor: THEME_COLORS.primaryHover }
            }}
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
            <div 
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: THEME_COLORS.primary }}
            >
              <Mic size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">SecureVoice v3</h1>
              <p className="text-sm text-gray-400">Привет, {currentUser?.name}!</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {joinRequests.length > 0 && (
              <button 
                onClick={() => setShowRequestsPopup(true)}
                className="relative p-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                <Bell size={20} />
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {joinRequests.length}
                </span>
              </button>
            )}
            <button className="p-2 hover:bg-gray-800 rounded-lg">
              <Settings size={20} />
            </button>
            <button 
              onClick={logout}
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
            className="p-6 rounded-xl transition-colors text-left hover:brightness-110"
            style={{ backgroundColor: THEME_COLORS.primary }}
          >
            <Plus size={24} className="mb-3" />
            <h3 className="font-semibold mb-1">Создать встречу</h3>
            <p className="text-sm opacity-80">Новая защищенная комната</p>
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
            onClick={() => setCurrentView('my-rooms')}
            className="p-6 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors text-left"
          >
            <Calendar size={24} className="mb-3" />
            <h3 className="font-semibold mb-1">Мои комнаты</h3>
            <p className="text-sm text-gray-400">Созданные комнаты ({userRooms.length})</p>
          </button>
        </div>

        {/* Recent Rooms */}
        <div className="mb-8">
          <h2 className="text-lg font-medium mb-4">Активные комнаты</h2>
          <div className="space-y-3">
            {rooms.slice(0, 5).map((room) => (
              <div key={room.id} className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                      <Lock size={16} style={{ color: THEME_COLORS.primary }} />
                      <h3 className="font-medium">{room.name}</h3>
                      {room.creator_id === currentUser?.user_id && (
                        <Crown size={14} className="text-yellow-400" title="Ваша комната" />
                      )}
                    </div>
                    <div className="flex items-center space-x-1">
                      <div 
                        className="w-2 h-2 rounded-full animate-pulse"
                        style={{ backgroundColor: THEME_COLORS.primary }}
                      ></div>
                      <span className="text-sm" style={{ color: THEME_COLORS.primary }}>Активна</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 text-gray-400">
                    <div className="flex items-center space-x-1">
                      <Users size={16} />
                      <span className="text-sm">{room.participants_count}/{room.max_participants}</span>
                    </div>
                    <button 
                      onClick={() => {
                        setJoinCode(room.id);
                        setCurrentView('join');
                      }}
                      className="px-3 py-1 text-white text-sm rounded transition-colors hover:brightness-110"
                      style={{ backgroundColor: THEME_COLORS.primary }}
                    >
                      Присоединиться
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
              <div 
                className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}
              ></div>
              <span className={isConnected ? 'text-green-400' : 'text-red-400'}>
                {isConnected ? 'Подключено' : 'Отключено'}
              </span>
            </div>
            <div className="flex items-center space-x-2 text-gray-400">
              <Shield size={14} style={{ color: THEME_COLORS.primary }} />
              <span>Защищенное соединение v3</span>
            </div>
          </div>
        </div>
      </div>

      {/* Join Requests Popup */}
      <JoinRequestPopup
        requests={joinRequests}
        onApprove={approveUser}
        onReject={rejectUser}
        onClose={() => setShowRequestsPopup(false)}
        isVisible={showRequestsPopup}
      />
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
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
              style={{ borderColor: newRoomName.trim() ? THEME_COLORS.primary : '' }}
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
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
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
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
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
                <span className="text-sm">Зал ожидания (одобрение создателем)</span>
              </label>
            </div>
          </div>

          <button
            onClick={createRoom}
            disabled={!newRoomName.trim()}
            className="w-full text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:bg-gray-600 hover:brightness-110"
            style={{ 
              backgroundColor: newRoomName.trim() ? THEME_COLORS.primary : ''
            }}
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
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
              style={{ borderColor: joinCode.trim() ? THEME_COLORS.primary : '' }}
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
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
              placeholder="Введите пароль"
            />
          </div>

          <button
            onClick={() => joinRoom(joinCode)}
            disabled={!joinCode.trim()}
            className="w-full text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:bg-gray-600 hover:brightness-110"
            style={{ 
              backgroundColor: joinCode.trim() ? THEME_COLORS.primary : ''
            }}
          >
            Присоединиться
          </button>
        </div>
      </div>
    </div>
  );

  // My Rooms View
  const MyRoomsView = () => (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button onClick={() => setCurrentView('main')} className="p-2 hover:bg-gray-800 rounded-lg">
              <X size={20} />
            </button>
            <h1 className="text-xl font-semibold">Мои комнаты</h1>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto">
        <div className="space-y-4">
          {userRooms.map((room) => (
            <div key={room.id} className="bg-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <Crown size={20} className="text-yellow-400" />
                  <div>
                    <h3 className="text-lg font-medium">{room.name}</h3>
                    <p className="text-sm text-gray-400">
                      Создана {new Date(room.created_at * 1000).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      const roomLink = `${window.location.origin}?room=${room.id}`;
                      navigator.clipboard.writeText(roomLink);
                      alert('Ссылка скопирована!');
                    }}
                    className="p-2 rounded-lg transition-colors hover:brightness-110"
                    style={{ backgroundColor: THEME_COLORS.primary }}
                    title="Копировать ссылку"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => deleteRoom(room.id)}
                    className="p-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                    title="Удалить комнату"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-400">Участников:</span>
                  <span className="ml-2">{room.participants_count || 0}/{room.max_participants}</span>
                </div>
                <div>
                  <span className="text-gray-400">Пароль:</span>
                  <span className="ml-2">{room.requires_password ? '✓' : '✗'}</span>
                </div>
                <div>
                  <span className="text-gray-400">Зал ожидания:</span>
                  <span className="ml-2">{room.has_waiting_room ? '✓' : '✗'}</span>
                </div>
                <div>
                  <span className="text-gray-400">Статус:</span>
                  <span className={`ml-2 ${room.is_active ? 'text-green-400' : 'text-gray-400'}`}>
                    {room.is_active ? 'Активна' : 'Неактивна'}
                  </span>
                </div>
              </div>

              {room.pending_requests_count > 0 && (
                <div className="mt-4 p-3 bg-yellow-900 bg-opacity-30 rounded-lg border border-yellow-600">
                  <div className="flex items-center space-x-2">
                    <AlertCircle size={16} className="text-yellow-400" />
                    <span className="text-yellow-400 font-medium">
                      {room.pending_requests_count} запросов на подключение
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}

          {userRooms.length === 0 && (
            <div className="text-center py-12">
              <Calendar size={48} className="mx-auto text-gray-600 mb-4" />
              <h3 className="text-lg font-medium text-gray-400 mb-2">У вас пока нет комнат</h3>
              <p className="text-gray-500 mb-4">Создайте свою первую комнату для встреч</p>
              <button
                onClick={() => setCurrentView('create')}
                className="px-6 py-2 text-white rounded-lg transition-colors hover:brightness-110"
                style={{ backgroundColor: THEME_COLORS.primary }}
              >
                Создать комнату
              </button>
            </div>
          )}
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
              className="flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors hover:brightness-110"
              style={{ backgroundColor: THEME_COLORS.primary }}
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
                  <div 
                    className={`w-2 h-2 rounded-full ${microphoneLevel > 10 ? 'bg-green-400' : 'bg-gray-400'}`}
                  ></div>
                  <span className="text-sm text-gray-400">
                    {microphoneLevel > 10 ? 'Активен' : 'Тишина'}
                  </span>
                </div>
              </div>
              
              <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                <div 
                  className="h-3 rounded-full transition-all duration-100"
                  style={{ 
                    width: `${Math.min(microphoneLevel, 100)}%`,
                    background: microphoneLevel > 50 ? 
                      'linear-gradient(to right, #fbbf24, #ef4444)' :
                      microphoneLevel > 20 ? 
                        'linear-gradient(to right, #22c55e, #fbbf24)' :
                        `linear-gradient(to right, ${THEME_COLORS.primary}, #22c55e)`
                  }}
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
                onClick={toggleMute}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                  isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                <span>{isMuted ? 'Микрофон выключен' : 'Микрофон включен'}</span>
              </button>

              <button
                onClick={toggleSpeaker}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                  isSpeakerMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {isSpeakerMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                <span>{isSpeakerMuted ? 'Звук выключен' : 'Звук включен'}</span>
              </button>

              <button
                onClick={toggleAllMute}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                  isAllMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {isAllMuted ? <VolumeOff size={16} /> : <Volume1 size={16} />}
                <span>{isAllMuted ? 'Все отключено' : 'Все включено'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Participants */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="font-medium mb-4">Участники ({participants.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {participants.map((participant) => (
              <ParticipantCard
                key={participant.id}
                participant={participant}
                isSpeaking={speakingUsers.has(participant.id)}
                showVolumeControl={false}
              />
            ))}
          </div>
        </div>

        {/* Join Call Button */}
        <button
          onClick={startCall}
          className="w-full text-white font-medium py-4 px-6 rounded-lg transition-colors flex items-center justify-center space-x-2 hover:brightness-110"
          style={{ backgroundColor: THEME_COLORS.primary }}
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
              <div key={participant.id} className="h-full">
                <ParticipantCard
                  participant={participant}
                  isSpeaking={speakingUsers.has(participant.id)}
                  showVolumeControl={true}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center space-x-4">
          <button
            onClick={toggleMute}
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
            onClick={toggleSpeaker}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isSpeakerMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {isSpeakerMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>

          <button
            onClick={toggleAllMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isAllMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {isAllMuted ? <VolumeOff size={20} /> : <Volume1 size={20} />}
          </button>

          <button
            onClick={shareRoom}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-colors hover:brightness-110"
            style={{ backgroundColor: THEME_COLORS.primary }}
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
                className="h-2 rounded-full transition-all duration-100"
                style={{ 
                  width: `${Math.min(microphoneLevel, 100)}%`,
                  background: microphoneLevel > 50 ? 
                    'linear-gradient(to right, #fbbf24, #ef4444)' :
                    microphoneLevel > 20 ? 
                      'linear-gradient(to right, #22c55e, #fbbf24)' :
                      `linear-gradient(to right, ${THEME_COLORS.primary}, #22c55e)`
                }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Waiting for Approval View
  const WaitingApprovalView = () => (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full mx-4">
        <div className="text-center">
          <div 
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: '#fbbf24' }}
          >
            <Clock size={32} />
          </div>
          <h2 className="text-2xl font-bold mb-2">Ожидание одобрения</h2>
          <p className="text-gray-400 mb-6">
            Ваш запрос отправлен создателю комнаты. Ожидайте одобрения для входа.
          </p>
          <div className="bg-gray-700 rounded-lg p-4 mb-6">
            <h3 className="font-medium mb-2">{currentRoom?.name}</h3>
            <p className="text-sm text-gray-400">
              Создатель: {currentRoom?.creator_name}
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
      case 'my-rooms':
        return <MyRoomsView />;
      case 'pre-call':
        return <PreCallView />;
      case 'call':
        return <CallView />;
      case 'waiting-approval':
        return <WaitingApprovalView />;
      default:
        return <AuthView />;
    }
  };

  return renderCurrentView();
};

export default SecureVoiceApp;
