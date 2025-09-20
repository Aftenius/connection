import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Mic, 
  MicOff, 
  Phone, 
  Users, 
  Settings,
  Volume2,
  VolumeX,
  Mic2,
  PhoneCall
} from 'lucide-react';
import CookieSessionManager from '../utils/CookieSessionManager';

const MeetingRoom = () => {
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
  const [isAudioOnlyMode, setIsAudioOnlyMode] = useState(true); // Всегда только аудио
  
  // Refs
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef(new Map());
  const wsRef = useRef(null);
  const peerConnections = useRef(new Map());
  const callStartTime = useRef(null);
  const durationInterval = useRef(null);
  const audioContext = useRef(null);
  const analyser = useRef(null);
  const microphone = useRef(null);
  const dataArray = useRef(null);
  const animationFrame = useRef(null);
  
  const API_BASE_URL = process.env.REACT_APP_API_URL || window.location.origin;
  const sessionManager = new CookieSessionManager();

  const normalizeParticipant = useCallback((participant, fallbackId) => {
    if (!participant && !fallbackId) {
      return null;
    }

    const data = { ...(participant || {}) };
    const participantId = data.id || data.user_id || data.userId || fallbackId;

    if (!participantId) {
      return null;
    }

    data.id = participantId;
    data.user_id = participantId;

    if (!data.name) {
      data.name = data.user_name || `Участник ${String(participantId).slice(0, 8)}`;
    }

    if (data.is_speaking === undefined) {
      data.is_speaking = false;
    } else {
      data.is_speaking = Boolean(data.is_speaking);
    }

    return data;
  }, []);

  // WebRTC конфигурация
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
  };


  // Отправка WebRTC сообщений через WebSocket
  const sendWebRTCMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);


  // Обработка WebRTC событий
  const handleUserJoined = useCallback((user) => {
    const normalizedUser = normalizeParticipant(user);
    if (!normalizedUser) {
      console.warn('⚠️ Не удалось обработать данные участника при user_joined:', user);
      return;
    }

    const participantId = normalizedUser.id;
    const currentUserId = currentUser?.id || currentUser?.user_id;

    console.log('👤 Пользователь присоедился:', normalizedUser);
    setParticipants(prev => {
      const exists = prev.find(p => p.id === participantId);
      if (exists) {
        console.log('⚠️ Пользователь уже в списке, обновляем данные:', normalizedUser.name);
        return prev.map(p => (p.id === participantId ? { ...p, ...normalizedUser } : p));
      }
      console.log('✅ Добавляем участника:', normalizedUser.name, 'Всего участников:', prev.length + 1);
      return [...prev, normalizedUser];
    });

    if (!participantId || participantId === currentUserId) {
      return;
    }

    if (localStream) {
      createPeerConnection(participantId).then(pc => {
        if (pc && localStream) {
          pc.createOffer().then(offer => {
            pc.setLocalDescription(offer).then(() => {
              sendWebRTCMessage({
                type: 'webrtc_offer',
                to: participantId,
                offer: offer
              });
            });
          }).catch(error => {
            console.error('❌ Ошибка создания offer:', error);
          });
        }
      });
    }
  }, [createPeerConnection, currentUser, localStream, normalizeParticipant, sendWebRTCMessage]);

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
    if (!userId) {
      console.warn('⚠️ Невозможно создать WebRTC соединение: не указан идентификатор пользователя');
      return null;
    }

    console.log('🔗 Создаем WebRTC соединение с:', userId);

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.current.set(userId, pc);

    // Добавляем только аудио треки
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        pc.addTrack(track, localStream);
        console.log('🎤 Добавлен аудио трек:', track.kind);
      });
    }

    // Обработка удаленного аудио потока
    pc.ontrack = (event) => {
      console.log('🎵 Получен удаленный аудио поток от:', userId);
      const remoteStream = event.streams[0];
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        newMap.set(userId, remoteStream);
        return newMap;
      });
      
      // Создаем аудио элемент для воспроизведения
      const audio = new Audio();
      audio.srcObject = remoteStream;
      audio.autoplay = true;
      audio.volume = 1.0;
      audio.play().catch(e => console.log('❌ Ошибка воспроизведения аудио:', e));
      console.log('🔊 Аудио элемент создан для:', userId);
    };

    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('🧊 Отправляем ICE candidate для:', userId);
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
      if (pc.iceConnectionState === 'connected') {
        console.log('✅ WebRTC соединение установлено с:', userId);
      }
    };

    return pc;
  }, [localStream, rtcConfig, sendWebRTCMessage]);

  // Отправка общих WebSocket сообщений
  const sendWebSocketMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Обработка WebRTC offer
  const handleWebRTCOffer = useCallback(async (message) => {
    try {
      const senderId = message.from || message.user_id;
      if (!senderId) {
        console.warn('⚠️ Получен WebRTC offer без идентификатора отправителя:', message);
        return;
      }

      const pc = await createPeerConnection(senderId);
      if (!pc) {
        return;
      }

      await pc.setRemoteDescription(message.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendWebRTCMessage({
        type: 'webrtc_answer',
        to: senderId,
        answer: answer
      });
    } catch (error) {
      console.error('❌ Ошибка обработки WebRTC offer:', error);
    }
  }, [createPeerConnection, sendWebRTCMessage]);

  // Обработка WebRTC answer
  const handleWebRTCAnswer = useCallback(async (message) => {
    try {
      const senderId = message.from || message.user_id;
      if (!senderId) {
        console.warn('⚠️ Получен WebRTC answer без идентификатора отправителя:', message);
        return;
      }

      const pc = peerConnections.current.get(senderId);
      if (pc) {
        await pc.setRemoteDescription(message.answer);
      }
    } catch (error) {
      console.error('❌ Ошибка обработки WebRTC answer:', error);
    }
  }, []);

  // Обработка WebRTC ICE candidate
  const handleWebRTCIceCandidate = useCallback(async (message) => {
    try {
      const senderId = message.from || message.user_id;
      if (!senderId) {
        console.warn('⚠️ Получен ICE candidate без идентификатора отправителя:', message);
        return;
      }

      const pc = peerConnections.current.get(senderId);
      if (pc) {
        await pc.addIceCandidate(message.candidate);
      }
    } catch (error) {
      console.error('❌ Ошибка обработки ICE candidate:', error);
    }
  }, []);

  // Подключение к WebSocket
  const connectWebSocket = useCallback((roomId, userId) => {
    console.log('🔌 Подключаемся к WebSocket:', { roomId, userId });
    console.log('🌐 window.location.hostname:', window.location.hostname);
    console.log('🌐 window.location.protocol:', window.location.protocol);
    console.log('🌐 window.location.host:', window.location.host);
    
    // Используем wss:// для HTTPS и ws:// для HTTP
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Используем тот же хост и порт, что и основное приложение (через Nginx)
    const wsUrl = `${protocol}//${window.location.host}/ws/${roomId}/${userId}`;
    console.log('🔗 WebSocket URL:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('✅ WebSocket подключен');
      wsRef.current = ws;
      
      // Отправляем сообщение о присоединении к комнате
      ws.send(JSON.stringify({
        type: 'user_joined',
        user_id: userId,
        user_name: currentUser?.name
      }));
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('📨 Получено WebSocket сообщение:', message);
        
        switch (message.type) {
          case 'user_joined': {
            const incomingUser = message.user || {
              id: message.user_id,
              user_id: message.user_id,
              name: message.user_name,
              status: message.status
            };

            const normalizedUser = normalizeParticipant(incomingUser, message.user_id);

            if (!normalizedUser) {
              console.warn('⚠️ Получено сообщение user_joined без корректных данных:', message);
              break;
            }

            const participantId = normalizedUser.id;
            const currentUserId = currentUser?.id || currentUser?.user_id;

            if (participantId === currentUserId) {
              console.log('⚠️ Игнорируем собственное сообщение о присоединении');
              break;
            }

            handleUserJoined(normalizedUser);
            break;
          }
            
          case 'user_left':
            console.log('👋 Пользователь покинул комнату:', message.user_name);
            // Удаляем участника
            setParticipants(prev => prev.filter(p => p.id !== message.user_id));
            // Закрываем WebRTC соединение
            const pc = peerConnections.current.get(message.user_id);
            if (pc) {
              pc.close();
              peerConnections.current.delete(message.user_id);
            }
            break;
            
          case 'speaking_status':
            console.log('🎤 Статус речи:', message.user_name, message.is_speaking ? 'ГОВОРИТ' : 'МОЛЧИТ');
            // Обновляем статус речи участника
            setParticipants(prev => prev.map(p => 
              p.id === message.user_id 
                ? { ...p, is_speaking: message.is_speaking }
                : p
            ));
            break;
            
          case 'webrtc_offer': {
            const senderId = message.from || message.user_id;
            console.log('📞 Получен WebRTC offer от:', senderId);
            handleWebRTCOffer(message);
            break;
          }

          case 'webrtc_answer': {
            const senderId = message.from || message.user_id;
            console.log('📞 Получен WebRTC answer от:', senderId);
            handleWebRTCAnswer(message);
            break;
          }

          case 'webrtc_ice_candidate': {
            const senderId = message.from || message.user_id;
            console.log('🧊 Получен ICE candidate от:', senderId);
            handleWebRTCIceCandidate(message);
            break;
          }

          case 'participants_update':
            console.log('👥 Обновление списка участников:', message.participants);
            if (message.participants && Array.isArray(message.participants)) {
              const currentUserId = currentUser?.id || currentUser?.user_id;
              const normalizedParticipants = message.participants
                .map(participant => normalizeParticipant(participant))
                .filter(participant => participant && participant.id !== currentUserId);

              console.log('✅ Обновляем участников:', normalizedParticipants);
              setParticipants(normalizedParticipants);

              normalizedParticipants.forEach(participant => {
                if (!participant?.id || participant.id === currentUserId) {
                  return;
                }

                if (localStream) {
                  console.log('🔗 Создаем WebRTC соединение с существующим участником:', participant.name);
                  setTimeout(() => {
                    if (peerConnections.current.has(participant.id)) {
                      return;
                    }

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
                  }, 1000);
                }
              });
            }
            break;
            
          default:
            console.log('❓ Неизвестный тип сообщения:', message.type);
        }
    } catch (error) {
        console.error('❌ Ошибка парсинга WebSocket сообщения:', error);
      }
    };
    
    ws.onclose = () => {
      console.log('🔌 WebSocket отключен');
      wsRef.current = null;
    };
    
    ws.onerror = (error) => {
      console.error('❌ Ошибка WebSocket:', error);
    };
  }, [currentUser, handleWebRTCOffer, handleWebRTCAnswer, handleWebRTCIceCandidate, handleUserJoined, normalizeParticipant, localStream, sendWebRTCMessage]);

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
      
      console.log('🎤 Анализ аудио настроен');
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
    
    // Отправляем статус речи только при изменении
    if (currentlySpeaking !== isSpeaking) {
      console.log('🎤 Статус речи изменился:', currentlySpeaking ? 'ГОВОРИТ' : 'МОЛЧИТ');
      setIsSpeaking(currentlySpeaking);
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'speaking_status',
          user_id: currentUser?.id,
          is_speaking: currentlySpeaking
        }));
      }
    }
    
    // Продолжаем анализ
    animationFrame.current = requestAnimationFrame(analyzeAudio);
  }, [isSpeaking, currentUser?.id]);

  // Получение медиа устройств (только аудио)
  const getUserMedia = useCallback(async () => {
    try {
      console.log('🎤 Запрашиваем доступ к микрофону (только аудио)');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        },
        video: false // Всегда только аудио
      });

      setLocalStream(stream);

      // Настраиваем анализ аудио для детекции речи
      setupAudioAnalysis(stream);

      // Запускаем анализ аудио
      if (analyser.current && dataArray.current) {
        analyzeAudio();
      }

      return stream;
    } catch (error) {
      console.error('❌ Ошибка доступа к микрофону:', error);
      alert('Не удалось получить доступ к микрофону. Проверьте разрешения.');
      throw error;
    }
  }, [setupAudioAnalysis, analyzeAudio]);


  // Получение участников комнаты
  const loadRoomParticipants = useCallback(async () => {
    try {
      console.log('🔄 Загружаем участников комнаты:', roomId);
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId}`);
      console.log('📥 Ответ сервера:', response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('📦 Данные комнаты:', data);
        if (data.room && data.room.participants) {
          console.log('👥 Загружены участники комнаты:', data.room.participants);
          const normalized = data.room.participants
            .map(participant => normalizeParticipant(participant))
            .filter(Boolean);
          setParticipants(normalized);
        } else {
          console.log('⚠️ Участники не найдены в данных комнаты');
        }
      } else {
        console.error('❌ Ошибка загрузки участников:', response.status);
      }
    } catch (error) {
      console.error('❌ Ошибка загрузки участников комнаты:', error);
    }
  }, [roomId, API_BASE_URL, normalizeParticipant]);

  // Присоединение к комнате
  const joinRoom = useCallback(async () => {
    console.log('🚪 joinRoom вызвана:', { roomId, isInRoom, isAuthenticated, currentUser: currentUser?.name });
    if (!roomId || !isAuthenticated || !currentUser || (!currentUser.id && !currentUser.user_id)) {
      console.log('❌ joinRoom: условия не выполнены');
      return;
    }
    
    // Если уже в комнате, просто обновляем соединения
    if (isInRoom) {
      console.log('🔄 Уже в комнате, обновляем соединения');
      // Переподключаемся к WebSocket если нужно
      const userId = currentUser.id || currentUser.user_id;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.log('🔌 Переподключаемся к WebSocket');
        connectWebSocket(roomId, userId);
      }
      return;
    }

    try {
      console.log('🚪 Присоединяемся к комнате:', roomId, 'пользователь:', currentUser.name);
      
      // Загружаем существующих участников
      await loadRoomParticipants();
      
      // Добавляем текущего пользователя в список участников только если его там нет
      setParticipants(prev => {
        console.log('👥 Текущий список участников:', prev);
        const userId = currentUser.id || currentUser.user_id;
        const normalizedCurrentUser = normalizeParticipant(currentUser, userId);

        if (!userId || !normalizedCurrentUser) {
          console.warn('⚠️ Не удалось нормализовать текущего пользователя при добавлении в список');
          return prev;
        }

        const exists = prev.find(p => p.id === userId);
        if (!exists) {
          console.log('✅ Добавляем текущего пользователя в участники:', normalizedCurrentUser.name);
          const newParticipants = [...prev, normalizedCurrentUser];
          console.log('👥 Новый список участников:', newParticipants);
          return newParticipants;
        }
        console.log('⚠️ Пользователь уже в списке участников, обновляем данные');
        return prev.map(p => (p.id === userId ? { ...p, ...normalizedCurrentUser } : p));
      });
      
      // Подключаемся к WebSocket
      console.log('🔍 Проверяем currentUser для WebSocket:', {
        currentUser,
        hasId: !!currentUser?.id,
        hasUserId: !!currentUser?.user_id,
        id: currentUser?.id,
        user_id: currentUser?.user_id
      });
      
      if (currentUser && (currentUser.id || currentUser.user_id)) {
        const userId = currentUser.id || currentUser.user_id;
        console.log('🔌 Подключаемся к WebSocket с пользователем:', userId);
        connectWebSocket(roomId, userId);
      } else {
        console.error('❌ currentUser или currentUser.id/user_id не определен:', currentUser);
      }
      
      // Получаем только аудио
      await getUserMedia();

      setIsInRoom(true);
      console.log('✅ Успешно присоединились к комнате');

      // Инициируем WebRTC соединения с существующими участниками
      const currentUserId = currentUser.id || currentUser.user_id;
      setTimeout(() => {
        participants.forEach(participant => {
          const participantId = participant?.id || participant?.user_id;
          if (!participantId || participantId === currentUserId || !localStream) {
            return;
          }

          console.log('🔗 Инициируем WebRTC соединение с существующим участником:', participant.name);
          createPeerConnection(participantId).then(pc => {
              if (pc && localStream) {
                pc.createOffer().then(offer => {
                  pc.setLocalDescription(offer).then(() => {
                    sendWebRTCMessage({
                      type: 'webrtc_offer',
                      to: participantId,
                      offer: offer
                    });
                  });
                }).catch(error => {
                  console.error('❌ Ошибка создания offer для существующего участника:', error);
                });
              }
          });
        });
      }, 1000); // Задержка для стабилизации соединения

    } catch (error) {
      console.error('❌ Ошибка присоединения к комнате:', error);
      alert('Ошибка присоединения к комнате: ' + error.message);
      navigate('/');
    }
  }, [roomId, isInRoom, isAuthenticated, currentUser, navigate, getUserMedia, createPeerConnection, sendWebRTCMessage, loadRoomParticipants, isAudioOnlyMode, participants, localStream, connectWebSocket, normalizeParticipant]);

  // Начать звонок
  const startCall = useCallback(async () => {
    try {
      console.log('📞 Начинаем звонок');
      setIsCallActive(true);
      setIsInCall(true);
      
      // Запускаем таймер времени разговора
      callStartTime.current = Date.now();
      durationInterval.current = setInterval(() => {
        if (callStartTime.current) {
          setCallDuration(Math.floor((Date.now() - callStartTime.current) / 1000));
        }
      }, 1000);
      
      // Аудио уже получено в joinRoom
      
      // Уведомляем других участников о начале звонка
      sendWebSocketMessage({
        type: 'call_started',
        user_id: currentUser?.id
      });
      
    } catch (error) {
      console.error('❌ Ошибка начала звонка:', error);
    }
  }, [currentUser, sendWebSocketMessage]);

  // Завершить звонок
  const endCall = useCallback(() => {
    console.log('📞 Завершаем звонок');
    setIsCallActive(false);
    setIsInCall(false);
    
    // Останавливаем таймер времени разговора
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    callStartTime.current = null;
    setCallDuration(0);
    
    // Аудио остается включенным
    
    // Уведомляем других участников о завершении звонка
    sendWebSocketMessage({
      type: 'call_ended',
      user_id: currentUser?.id
    });
  }, [localStream, currentUser, sendWebSocketMessage]);



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

  // Выход из комнаты
  const leaveRoom = useCallback(() => {
    console.log('🚪 Покидаем комнату');
    
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
      console.log('🔄 Восстановление сессии в MeetingRoom...');
      console.log('🔍 Проверяем localStorage:', {
        securevoice_session: localStorage.getItem('securevoice_session'),
        secure_voice_session: localStorage.getItem('secure_voice_session')
      });
      
      // Проверяем и восстанавливаем сессию из securevoice_session
      const hasValid = await sessionManagerInstance.hasValidSession();
      console.log('🔍 hasValidSession():', hasValid);
      
      if (hasValid) {
        const user = await sessionManagerInstance.getCurrentUser();
        console.log('✅ Сессия найдена в MeetingRoom:', user);
        setIsAuthenticated(true);
        setCurrentUser(user);
      } else {
        console.log('❌ Сессия не найдена или невалидна, создаем новую');
        
        // Создаем пользователя с тем же форматом, что и App.js
        const newUser = {
          id: `user_${Date.now()}`,
          name: `Пользователь ${Math.floor(Math.random() * 1000)}`,
          is_creator: false,
          user_id: `user_${Date.now()}`,
          stable_user_id: `stable_${Date.now()}`,
          user_hash: Math.random().toString(36).substring(2, 10)
        };
        
        console.log('👤 Создаем нового пользователя:', newUser);
        
        // Сохраняем в том же формате, что и App.js
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
  }, []); // Убираем sessionManagerInstance из зависимостей

  // Инициализация комнаты
  useEffect(() => {
    console.log('🔄 Инициализация комнаты:', { roomId, isInRoom, isAuthenticated, currentUser: currentUser?.name });
    
    if (roomId && isAuthenticated && currentUser && (currentUser.id || currentUser.user_id)) {
      console.log('✅ Все условия выполнены, присоединяемся к комнате');
      // Небольшая задержка для правильной инициализации
      const timer = setTimeout(() => {
        joinRoom();
      }, 100); // Уменьшаем задержку, так как аутентификация уже завершена
      
      return () => clearTimeout(timer);
    } else {
      console.log('❌ Условия не выполнены для присоединения к комнате');
    }
    
    return () => {
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
      }
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [roomId, isAuthenticated, currentUser]); // Убираем isInRoom из зависимостей

  // Обновление видео элементов при изменении удаленных потоков
  useEffect(() => {
    remoteStreams.forEach((stream, userId) => {
      const videoElement = remoteVideoRefs.current.get(userId);
      if (videoElement && videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
        console.log('🔄 Обновлен видео элемент для:', userId);
      }
    });
  }, [remoteStreams]);

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

  // Обновление удаленных видео элементов
  useEffect(() => {
    remoteStreams.forEach((stream, userId) => {
      const videoElement = remoteVideoRefs.current.get(userId);
      if (videoElement) {
        videoElement.srcObject = stream;
      }
    });
  }, [remoteStreams]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Заголовок */}
      <div className="bg-gray-800 p-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">
            {isAudioOnlyMode ? 'Аудио-комната' : 'Видео-комната'}: {roomId}
          </h1>
          <p className="text-gray-400">
            {isInCall ? `Длительность: ${formatDuration(callDuration)}` : 'Готов к звонку'}
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
            <Phone className="w-4 h-4" />
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
              <h2 className="text-2xl font-bold mb-2">Готов к звонку</h2>
              <p className="text-gray-400">Нажмите "Начать звонок" чтобы начать встречу</p>
            </div>
            <button
              onClick={startCall}
              className="bg-green-600 hover:bg-green-700 px-8 py-4 rounded-lg text-lg font-semibold flex items-center space-x-2"
            >
              <Phone className="w-6 h-6" />
              <span>Начать звонок</span>
            </button>
          </div>
        ) : (
          // Интерфейс звонка
          <div className="space-y-6">
            {/* Аудио интерфейс */}
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
                onClick={() => setIsSpeakerOn(!isSpeakerOn)}
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
                <Phone className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MeetingRoom;