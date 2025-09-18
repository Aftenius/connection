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
  const [isAllMuted, setIsAllMuted] = useState(false); // Новое: отключение всего звука
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
  const [participantVolumes, setParticipantVolumes] = useState(new Map()); // Громкость участников
  
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
    const initialize = async () => {
      // Проверяем сохраненную сессию
      const savedName = sessionManager.getSavedUserName();
      if (savedName) {
        setUserName(savedName);
      }

      await loadRooms();

      // Проверяем URL параметры для автоматического присоединения
      const urlParams = new URLSearchParams(window.location.search);
      const roomId = urlParams.get('room');
      if (roomId && currentView === 'auth') {
        setJoinCode(roomId);
        if (savedName) {
          setCurrentView('join');
        }
      }
    };

    initialize();
    
    return () => {
      cleanup();
    };
  }, []);

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

  // Генерация уникального хэша пользователя
  const generateUserHash = useCallback((name, ip, userAgent) => {
    const data = `${name.toLowerCase()}-${ip}-${userAgent}-${Date.now()}`;
    // Простой хэш функция
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }, []);

  // Создание или восстановление сессии
  const authenticateUser = async (name) => {
    try {
      const sessionData = await sessionManager.createOrRestoreSession(name, API_BASE_URL);
      setCurrentUser(sessionData.user);
      setIsAuthenticated(true);
      setUserName(sessionData.user.name);
      
      // Загружаем комнаты пользователя
      await loadUserRooms();
      
      return sessionData;
    } catch (error) {
      console.error('Ошибка аутентификации:', error);
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
        track.enabled = isMuted; // Инвертируем, потому что состояние изменится
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
      // Отключаем всё
      setIsMuted(true);
      setIsSpeakerMuted(true);
      if (localStream) {
        localStream.getAudioTracks().forEach(track => {
          track.enabled = false;
        });
      }
    } else {
      // Возвращаем предыдущие состояния
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
          // Новый запрос на подключение (только для создателя)
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
          // Пользователь был одобрен
          if (data.user.id === currentUser?.user_id) {
            setAwaitingApproval(false);
            setCurrentView('pre-call');
          }
          break;
          
        case 'join_rejected':
          // Пользователь был отклонен
          if (data.user_id === currentUser?.user_id) {
            setAwaitingApproval(false);
            alert('Ваш запрос на подключение был отклонен');
            setCurrentView('main');
          }
          break;
          
        case 'room_deleted':
          // Комната была удалена
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
      
      // Переподключение через 3 секунды, если мы все еще в комнате
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
      
      // Подключаемся к WebSocket
      connectWebSocket(data.room_id, data.user.id);
      
      // Очищаем поля
      setNewRoomName('');
      setNewRoomPassword('');
      setNewRoomRequiresPassword(false);
      setNewRoomHasWaitingRoom(true);
      
      // Обновляем списки
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

    // Проверяем существование комнаты
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
        // Подключаемся к WebSocket для получения уведомлений
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

  // Одобрение пользователя (только для создателя)
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

      // Удаляем запрос из списка
      setJoinRequests(prev => prev.filter(req => req.user.id !== userId));
      
    } catch (error) {
      console.error('Ошибка одобрения:', error);
      alert('Ошибка одобрения: ' + error.message);
    }
  };

  // Отклонение пользователя (только для создателя)
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

      // Удаляем запрос из списка
      setJoinRequests(prev => prev.filter(req => req.user.id !== userId));
      
    } catch (error) {
      console.error('Ошибка отклонения:', error);
      alert('Ошибка отклонения: ' + error.message);
    }
  };

  // Удаление комнаты (только для создателя)
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

      // Обновляем списки
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
        {/* Фоновая анимация говорящего - не влияет на размер карточки */}
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
              
              {/* Индикаторы состояния */}
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

        {/* Контроль громкости (показывается при наведении в режиме звонка) */}
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

  // Основные компоненты представлений остаются почти теми же, но с обновленной темой и новыми функциями...
  
  // Auth View
  const AuthView = () => (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-md border border-gray-700">
        <div className="text-center mb-8">
          <div 
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: THEME_COLORS.primary }}
          >
            <Mic size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">SecureVoice</h1>
          <p className="text-gray-400">Защищенное голосовое общение v2</p>
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
      
      {/* CSS для анимаций */}
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
    </div>
  );

  // Здесь будут остальные компоненты представлений...
  // (Для краткости показываю только основную структрру)

  // Render current view
  const renderCurrentView = () => {
    switch (currentView) {
      case 'auth':
        return <AuthView />;
      case 'main':
        return <div>Main View - TODO</div>;
      case 'create':
        return <div>Create View - TODO</div>;
      case 'join':
        return <div>Join View - TODO</div>;
      case 'my-rooms':
        return <div>My Rooms View - TODO</div>;
      case 'pre-call':
        return <div>Pre Call View - TODO</div>;
      case 'call':
        return <div>Call View - TODO</div>;
      case 'waiting-approval':
        return <div>Waiting Approval View - TODO</div>;
      default:
        return <AuthView />;
    }
  };

  return renderCurrentView();
};

export default SecureVoiceApp;
