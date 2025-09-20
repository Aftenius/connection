import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Mic, 
  MicOff, 
  Phone, 
  Users, 
  Volume2,
  VolumeX,
  PhoneCall,
  PhoneOff
} from 'lucide-react';
import CookieSessionManager from '../utils/CookieSessionManager';

const AudioMeetingRoom = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  
  // Используем тот же CookieSessionManager, что и App.js
  const sessionManagerInstance = useMemo(() => new CookieSessionManager(), []);
  
  // Состояние
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [isInRoom, setIsInRoom] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [isCallActive, setIsCallActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  
  // Refs
  const wsRef = useRef(null);
  const peerConnections = useRef(new Map());
  const callStartTime = useRef(null);
  const durationInterval = useRef(null);
  const audioContext = useRef(null);
  const analyser = useRef(null);
  const microphone = useRef(null);
  const dataArray = useRef(null);
  const animationFrame = useRef(null);
  const audioElements = useRef(new Map());
  
  const API_BASE_URL = process.env.REACT_APP_API_URL || window.location.origin;
  const sessionManager = new CookieSessionManager();

  // WebRTC конфигурация
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // WebSocket соединение
  const connectWebSocket = useCallback((roomId, userId) => {
    const baseUrl = API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const wsUrl = `${baseUrl}/ws/${roomId}/${userId}`;
    console.log('🔌 Подключаемся к WebSocket:', wsUrl);
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('📨 WebSocket сообщение:', data);
        
        switch (data.type) {
          case 'user_joined':
            handleUserJoined(data.user);
            break;
          case 'user_left':
            handleUserLeft(data.user_id);
            break;
          case 'participants_update':
            if (data.participants) {
              console.log('👥 Обновление участников:', data.participants);
              setParticipants(data.participants);
              
              // Инициируем WebRTC соединения с новыми участниками
              setTimeout(() => {
                data.participants.forEach(participant => {
                  if (participant.id !== currentUser?.id && localStream && !peerConnections.current.has(participant.id)) {
                    console.log('🔗 Инициируем WebRTC соединение с участником из списка:', participant.name);
                    createPeerConnection(participant.id).then(pc => {
                      if (pc && localStream) {
                        pc.createOffer().then(offer => {
                          pc.setLocalDescription(offer).then(() => {
                            sendWebRTCMessage({
                              type: 'webrtc_offer',
                              to: participant.id,
                              offer: offer
                            });
                          });
                        }).catch(error => {
                          console.error('❌ Ошибка создания offer для участника из списка:', error);
                        });
                      }
                    });
                  }
                });
              }, 500);
            }
            break;
          case 'webrtc_offer':
            handleWebRTCOffer(data);
            break;
          case 'webrtc_answer':
            handleWebRTCAnswer(data);
            break;
          case 'webrtc_ice_candidate':
            handleWebRTCIceCandidate(data);
            break;
          case 'speaking':
            console.log('🎤 Получен статус речи от:', data.user_id, 'Говорит:', data.is_speaking);
            handleSpeakingStatus(data);
            break;
        }
      } catch (error) {
        console.error('❌ Ошибка обработки WebSocket:', error);
      }
    };

    ws.onopen = () => {
      console.log('✅ WebSocket подключен');
    };

    ws.onclose = () => {
      console.log('❌ WebSocket отключен');
    };

    ws.onerror = (error) => {
      console.error('❌ Ошибка WebSocket:', error);
    };
  }, [API_BASE_URL, currentUser?.id, localStream]);

  // Обработка WebRTC событий
  const handleUserJoined = (user) => {
    console.log('👤 Пользователь присоединился:', user);
    setParticipants(prev => {
      const exists = prev.find(p => p.id === user.id);
      if (exists) {
        console.log('⚠️ Пользователь уже в списке:', user.name);
        return prev;
      }
      console.log('✅ Добавляем участника:', user.name, 'Всего участников:', prev.length + 1);
      return [...prev, user];
    });
    
    // Создаем WebRTC соединение с новым пользователем
    if (localStream && user.id !== currentUser?.id) {
      createPeerConnection(user.id).then(pc => {
        // Создаем offer для инициации соединения
        if (pc && localStream) {
          pc.createOffer().then(offer => {
            pc.setLocalDescription(offer).then(() => {
              sendWebRTCMessage({
                type: 'webrtc_offer',
                to: user.id,
                offer: offer
              });
            });
          }).catch(error => {
            console.error('❌ Ошибка создания offer:', error);
          });
        }
      });
    }
  };

  const handleUserLeft = (userId) => {
    console.log('👋 Пользователь покинул:', userId);
    setParticipants(prev => prev.filter(p => p.id !== userId));
    
    // Закрываем WebRTC соединение
    const pc = peerConnections.current.get(userId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(userId);
    }
    
    // Удаляем удаленный поток
    setRemoteStreams(prev => {
      const newMap = new Map(prev);
      newMap.delete(userId);
      return newMap;
    });

    // Удаляем аудио элемент
    const audioElement = audioElements.current.get(userId);
    if (audioElement) {
      audioElement.remove();
      audioElements.current.delete(userId);
    }
  };

  const handleWebRTCOffer = async (data) => {
    console.log('📞 Получен WebRTC offer от:', data.from);
    
    // Создаем или получаем существующее соединение
    let pc = peerConnections.current.get(data.from);
    if (!pc) {
      pc = await createPeerConnection(data.from);
    }
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      sendWebRTCMessage({
        type: 'webrtc_answer',
        to: data.from,
        answer: answer
      });
    } catch (error) {
      console.error('❌ Ошибка обработки offer:', error);
    }
  };

  const handleWebRTCAnswer = async (data) => {
    console.log('📞 Получен WebRTC answer от:', data.from);
    const pc = peerConnections.current.get(data.from);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (error) {
        console.error('❌ Ошибка обработки answer:', error);
      }
    }
  };

  const handleWebRTCIceCandidate = async (data) => {
    console.log('🧊 Получен ICE candidate от:', data.from);
    const pc = peerConnections.current.get(data.from);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.error('❌ Ошибка добавления ICE candidate:', error);
      }
    }
  };

  const handleSpeakingStatus = (data) => {
    console.log('🎤 Обновляем статус речи для:', data.user_id, 'Говорит:', data.is_speaking);
    setSpeakingUsers(prev => {
      const newSet = new Set(prev);
      if (data.is_speaking) {
        newSet.add(data.user_id);
        console.log('✅ Добавляем говорящего пользователя:', data.user_id);
      } else {
        newSet.delete(data.user_id);
        console.log('❌ Удаляем говорящего пользователя:', data.user_id);
      }
      console.log('👥 Текущие говорящие:', Array.from(newSet));
      return newSet;
    });
  };

  // Создание WebRTC соединения
  const createPeerConnection = useCallback(async (userId) => {
    console.log('🔗 Создаем WebRTC соединение с:', userId);
    
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.current.set(userId, pc);

    // Добавляем локальный поток
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Обработка удаленного потока
    pc.ontrack = (event) => {
      console.log('🎵 Получен удаленный аудио поток от:', userId);
      const remoteStream = event.streams[0];
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        newMap.set(userId, remoteStream);
        return newMap;
      });
      
      // Создаем аудио элемент для воспроизведения
      const audioElement = document.createElement('audio');
      audioElement.srcObject = remoteStream;
      audioElement.autoplay = true;
      audioElement.playsInline = true;
      audioElement.volume = isSpeakerOn ? 1.0 : 0.0;
      
      // Добавляем в DOM
      document.body.appendChild(audioElement);
      audioElements.current.set(userId, audioElement);
      
      console.log('✅ Удаленный аудио поток привязан к элементу для:', userId);
    };

    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWebRTCMessage({
          type: 'webrtc_ice_candidate',
          to: userId,
          candidate: event.candidate
        });
      }
    };

    // Обработка изменения состояния соединения
    pc.onconnectionstatechange = () => {
      console.log(`🔗 Состояние соединения с ${userId}:`, pc.connectionState);
    };

    // Обработка изменения ICE соединения
    pc.oniceconnectionstatechange = () => {
      console.log(`🧊 ICE состояние с ${userId}:`, pc.iceConnectionState);
    };

    return pc;
  }, [localStream, isSpeakerOn]);

  // Отправка WebRTC сообщений через WebSocket
  const sendWebRTCMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Отправка общих WebSocket сообщений
  const sendWebSocketMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Получение только аудио потока
  const getAudioStream = useCallback(async () => {
    try {
      console.log('🎤 Запрашиваем доступ к микрофону');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        }
      });
      
      setLocalStream(stream);
      
      // Настраиваем анализ аудио для детекции речи
      setupAudioAnalysis(stream);
      
      return stream;
    } catch (error) {
      console.error('❌ Ошибка доступа к микрофону:', error);
      alert('Не удалось получить доступ к микрофону. Проверьте разрешения.');
      throw error;
    }
  }, []);

  // Настройка анализа аудио
  const setupAudioAnalysis = useCallback((stream) => {
    try {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
      analyser.current = audioContext.current.createAnalyser();
      microphone.current = audioContext.current.createMediaStreamSource(stream);
      
      analyser.current.fftSize = 256;
      analyser.current.smoothingTimeConstant = 0.8;
      microphone.current.connect(analyser.current);
      
      dataArray.current = new Uint8Array(analyser.current.frequencyBinCount);
      
      // Запускаем анализ
      analyzeAudio();
    } catch (error) {
      console.error('❌ Ошибка настройки анализа аудио:', error);
    }
  }, []);

  // Анализ аудио для детекции речи
  const analyzeAudio = useCallback(() => {
    if (!analyser.current || !dataArray.current) return;
    
    analyser.current.getByteFrequencyData(dataArray.current);
    
    // Вычисляем средний уровень звука
    const average = dataArray.current.reduce((a, b) => a + b) / dataArray.current.length;
    const threshold = 30; // Порог для детекции речи
    const currentlySpeaking = average > threshold;
    
    // Обновляем уровень аудио для визуализации
    setAudioLevel(Math.min(average / 100, 1));
    
    // Отправляем статус речи только при изменении
    if (currentlySpeaking !== isSpeaking) {
      console.log('🎤 Статус речи изменился:', currentlySpeaking ? 'ГОВОРИТ' : 'МОЛЧИТ');
      setIsSpeaking(currentlySpeaking);
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'speaking',
          user_id: currentUser?.id,
          is_speaking: currentlySpeaking
        }));
      }
    }
    
    // Продолжаем анализ
    animationFrame.current = requestAnimationFrame(analyzeAudio);
  }, [isSpeaking, currentUser?.id]);

  // Присоединение к комнате
  const joinRoom = useCallback(async () => {
    if (!roomId || isInRoom || !isAuthenticated || !currentUser) return;

    try {
      console.log('🚪 Присоединяемся к аудио-комнате:', roomId, 'пользователь:', currentUser.name);
      
      // Добавляем текущего пользователя в список участников
      setParticipants(prev => {
        const exists = prev.find(p => p.id === currentUser.id);
        if (!exists) {
          console.log('✅ Добавляем текущего пользователя в участники:', currentUser.name);
          return [...prev, currentUser];
        }
        return prev;
      });
      
      // Подключаемся к WebSocket
      connectWebSocket(roomId, currentUser.id);
      
      // Получаем только аудио поток
      await getAudioStream();
      
      setIsInRoom(true);
      console.log('✅ Успешно присоединились к аудио-комнате');
      
      // Инициируем WebRTC соединения с существующими участниками
      setTimeout(() => {
        participants.forEach(participant => {
          if (participant.id !== currentUser.id && localStream) {
            console.log('🔗 Инициируем WebRTC соединение с существующим участником:', participant.name);
            createPeerConnection(participant.id).then(pc => {
              if (pc && localStream) {
                pc.createOffer().then(offer => {
                  pc.setLocalDescription(offer).then(() => {
                    sendWebRTCMessage({
                      type: 'webrtc_offer',
                      to: participant.id,
                      offer: offer
                    });
                  });
                }).catch(error => {
                  console.error('❌ Ошибка создания offer для существующего участника:', error);
                });
              }
            });
          }
        });
      }, 1000); // Задержка для стабилизации соединения
      
    } catch (error) {
      console.error('❌ Ошибка присоединения к аудио-комнате:', error);
      alert('Ошибка присоединения к аудио-комнате: ' + error.message);
      navigate('/');
    }
  }, [roomId, isInRoom, isAuthenticated, currentUser, navigate, getAudioStream, createPeerConnection, sendWebRTCMessage, participants, localStream]);

  // Начать аудио-звонок
  const startCall = useCallback(async () => {
    try {
      console.log('📞 Начинаем аудио-звонок');
      setIsCallActive(true);
      setIsInCall(true);
      
      // Запускаем таймер времени разговора
      callStartTime.current = Date.now();
      durationInterval.current = setInterval(() => {
        if (callStartTime.current) {
          setCallDuration(Math.floor((Date.now() - callStartTime.current) / 1000));
        }
      }, 1000);
      
      // Уведомляем других участников о начале звонка
      sendWebSocketMessage({
        type: 'call_started',
        user_id: currentUser?.id
      });
      
    } catch (error) {
      console.error('❌ Ошибка начала аудио-звонка:', error);
    }
  }, [currentUser, sendWebSocketMessage]);

  // Завершить аудио-звонок
  const endCall = useCallback(() => {
    console.log('📞 Завершаем аудио-звонок');
    setIsCallActive(false);
    setIsInCall(false);
    
    // Останавливаем таймер времени разговора
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    callStartTime.current = null;
    setCallDuration(0);
    
    // Уведомляем других участников о завершении звонка
    sendWebSocketMessage({
      type: 'call_ended',
      user_id: currentUser?.id
    });
  }, [currentUser, sendWebSocketMessage]);

  // Переключить микрофон
  const toggleMute = useCallback(() => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      const newMutedState = !isMuted;
      audioTracks.forEach(track => {
        track.enabled = !newMutedState;
      });
      setIsMuted(newMutedState);
      console.log('🎤 Микрофон:', newMutedState ? 'выключен' : 'включен');
    }
  }, [localStream, isMuted]);

  // Переключить динамик
  const toggleSpeaker = useCallback(() => {
    const newSpeakerState = !isSpeakerOn;
    setIsSpeakerOn(newSpeakerState);
    
    // Обновляем громкость всех удаленных аудио элементов
    audioElements.current.forEach(audioElement => {
      audioElement.volume = newSpeakerState ? 1.0 : 0.0;
    });
    
    console.log('🔊 Динамик:', newSpeakerState ? 'включен' : 'выключен');
  }, [isSpeakerOn]);

  // Выход из комнаты
  const leaveRoom = useCallback(() => {
    console.log('🚪 Покидаем аудио-комнату');
    
    // Останавливаем медиа потоки
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    // Закрываем WebRTC соединения
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    
    // Очищаем удаленные потоки
    setRemoteStreams(new Map());
    
    // Удаляем аудио элементы
    audioElements.current.forEach(audioElement => {
      audioElement.remove();
    });
    audioElements.current.clear();
    
    // Останавливаем анализ аудио
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
    }
    
    if (audioContext.current) {
      audioContext.current.close();
    }
    
    // Закрываем WebSocket
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    setIsInCall(false);
    setIsInRoom(false);
    setParticipants([]);
    setCallDuration(0);
    
    if (callStartTime.current) {
      callStartTime.current = null;
    }
    
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
    }
    
    navigate('/');
  }, [localStream, navigate]);

  // Форматирование времени
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Восстановление сессии при монтировании
  useEffect(() => {
    const restoreSession = async () => {
      console.log('🔄 Восстановление сессии в AudioMeetingRoom...');
      
      // Проверяем и восстанавливаем сессию
      const hasValid = await sessionManagerInstance.hasValidSession();
      
      if (hasValid) {
        const user = await sessionManagerInstance.getCurrentUser();
        console.log('✅ Сессия найдена в AudioMeetingRoom:', user);
        setIsAuthenticated(true);
        setCurrentUser(user);
      } else {
        console.log('❌ Сессия не найдена или невалидна, создаем новую');
        
        // Создаем пользователя
        const newUser = {
          id: `user_${Date.now()}`,
          name: `Пользователь ${Math.floor(Math.random() * 1000)}`,
          is_creator: false,
          user_id: `user_${Date.now()}`,
          stable_user_id: `stable_${Date.now()}`,
          user_hash: Math.random().toString(36).substring(2, 10)
        };
        
        console.log('👤 Создаем нового пользователя:', newUser);
        
        // Сохраняем сессию
        sessionManagerInstance.saveSession({
          session_token: `session_${Date.now()}`,
          jwt_token: `jwt_${Date.now()}`,
          user: newUser,
          saved_at: Date.now()
        });
        
        setIsAuthenticated(true);
        setCurrentUser(newUser);
        console.log('✅ Новый пользователь сохранен и установлен');
      }
    };
    
    restoreSession();
  }, []);

  // Инициализация комнаты
  useEffect(() => {
    console.log('🔄 Инициализация аудио-комнаты:', { roomId, isInRoom, isAuthenticated });
    
    if (roomId && !isInRoom && isAuthenticated) {
      // Небольшая задержка для правильной инициализации
      const timer = setTimeout(() => {
        joinRoom();
      }, 500);
      
      return () => clearTimeout(timer);
    }
    
    return () => {
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
      }
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [roomId, isInRoom, isAuthenticated, joinRoom]);

  // Обработка навигации браузера
  useEffect(() => {
    const handleBeforeUnload = () => {
      leaveRoom();
    };
    
    const handlePopState = () => {
      leaveRoom();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [leaveRoom]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Заголовок */}
      <div className="bg-gray-800 p-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Аудио-комната: {roomId}</h1>
          <p className="text-gray-400">
            {isInCall ? `Длительность: ${formatDuration(callDuration)}` : 'Готов к аудио-звонку'}
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5" />
            <span>{participants.length} участников</span>
          </div>
          <button
            onClick={leaveRoom}
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg flex items-center space-x-2"
          >
            <PhoneOff className="w-4 h-4" />
            <span>Покинуть</span>
          </button>
        </div>
      </div>

      {/* Основной контент */}
      <div className="flex-1 p-4">
        {!isInCall ? (
          // Экран готовности
          <div className="flex flex-col items-center justify-center h-96 space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2">Готов к аудио-звонку</h2>
              <p className="text-gray-400">Нажмите "Начать звонок" чтобы начать аудио-встречу</p>
            </div>
            <button
              onClick={startCall}
              className="bg-green-600 hover:bg-green-700 px-8 py-4 rounded-lg text-lg font-semibold flex items-center space-x-2"
            >
              <PhoneCall className="w-6 h-6" />
              <span>Начать аудио-звонок</span>
            </button>
          </div>
        ) : (
          // Интерфейс аудио-звонка
          <div className="space-y-6">
            {/* Участники */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Текущий пользователь */}
              <div className="relative bg-gray-800 rounded-lg p-6 text-center">
                <div className="w-20 h-20 bg-blue-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <span className="text-2xl font-bold">
                    {currentUser?.name?.charAt(0)?.toUpperCase() || 'U'}
                  </span>
                </div>
                <h3 className="font-semibold mb-2">
                  {currentUser?.name || 'Вы'}
                  {isSpeaking && <span className="ml-2 text-green-400">🎤</span>}
                </h3>
                <div className="flex items-center justify-center space-x-2 mb-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-400">Подключен</span>
                </div>
                {/* Визуализация аудио */}
                <div className="flex justify-center space-x-1">
                  {[...Array(10)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 h-4 rounded ${
                        audioLevel > i / 10 ? 'bg-green-500' : 'bg-gray-600'
                      }`}
                    />
                  ))}
                </div>
                {isMuted && (
                  <div className="absolute top-2 right-2 bg-red-600 p-1 rounded">
                    <MicOff className="w-4 h-4" />
                  </div>
                )}
              </div>

              {/* Удаленные участники */}
              {participants
                .filter(p => p.id !== currentUser?.id)
                .map(participant => {
                  const isSpeaking = speakingUsers.has(participant.id);
                  
                  return (
                    <div key={participant.id} className="relative bg-gray-800 rounded-lg p-6 text-center">
                      <div className="w-20 h-20 bg-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                        <span className="text-2xl font-bold">
                          {participant.name?.charAt(0)?.toUpperCase() || 'U'}
                        </span>
                      </div>
                      <h3 className="font-semibold mb-2">
                        {participant.name || 'Участник'}
                        {isSpeaking && <span className="ml-2 text-green-400">🎤</span>}
                      </h3>
                      <div className="flex items-center justify-center space-x-2 mb-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span className="text-sm text-gray-400">Подключен</span>
                      </div>
                      {/* Визуализация аудио для удаленного участника */}
                      <div className="flex justify-center space-x-1">
                        {[...Array(10)].map((_, i) => (
                          <div
                            key={i}
                            className={`w-1 h-4 rounded ${
                              isSpeaking && Math.random() > 0.3 ? 'bg-green-500' : 'bg-gray-600'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Панель управления */}
            <div className="flex justify-center space-x-4">
              <button
                onClick={toggleMute}
                className={`p-4 rounded-full ${
                  isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
                title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
              >
                {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
              
              <button
                onClick={toggleSpeaker}
                className={`p-4 rounded-full ${
                  isSpeakerOn ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
                title={isSpeakerOn ? 'Выключить динамик' : 'Включить динамик'}
              >
                {isSpeakerOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
              </button>
              
              <button
                onClick={endCall}
                className="p-4 rounded-full bg-red-600 hover:bg-red-700"
                title="Завершить звонок"
              >
                <PhoneOff className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioMeetingRoom;
