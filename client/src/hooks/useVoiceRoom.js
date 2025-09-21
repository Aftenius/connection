import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' }
];

const SPEAKING_THRESHOLD = 38;

const extractParticipantId = (value, fallbackId = null) => {
  if (!value && !fallbackId) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return (
    value?.id ||
    value?.user_id ||
    value?.userId ||
    value?.from ||
    fallbackId ||
    null
  );
};

const normalizeParticipant = (participant, fallbackId = null) => {
  if (!participant && !fallbackId) {
    return null;
  }

  const data = { ...(participant || {}) };
  const id = extractParticipantId(data, fallbackId);

  if (!id) {
    return null;
  }

  return {
    id,
    user_id: id,
    name:
      data.name ||
      data.user_name ||
      data.username ||
      `Участник ${String(id).slice(0, 6)}`,
    is_creator: Boolean(data.is_creator),
    joined_at: data.joined_at || Date.now(),
    is_speaking: Boolean(data.is_speaking)
  };
};

export const useVoiceRoom = ({ roomId, currentUser, isAuthenticated }) => {
  const [localStream, setLocalStream] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState(() => new Map());
  const [speakingUsers, setSpeakingUsers] = useState(() => new Set());
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isInRoom, setIsInRoom] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const wsRef = useRef(null);
  const peersRef = useRef(new Map());
  const makingOfferRef = useRef(new Set());
  const pendingCandidatesRef = useRef(new Map());
  const messageQueueRef = useRef([]);
  const intentionalLeaveRef = useRef(false);
  const callTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const analyserDataRef = useRef(null);
  const animationRef = useRef(null);
  const lastSpeakingRef = useRef(false);

  const apiOrigin = useMemo(() => {
    const rawOrigin = process.env.REACT_APP_API_URL || window.location.origin;

    try {
      return new URL(rawOrigin).origin;
    } catch (originError) {
      console.warn(
        'useVoiceRoom: не удалось разобрать REACT_APP_API_URL, используем window.location.origin',
        originError
      );
      return window.location.origin;
    }
  }, []);

  const currentUserId = useMemo(
    () => currentUser?.id || currentUser?.user_id || currentUser?.userId || null,
    [currentUser]
  );

  const flushMessageQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || messageQueueRef.current.length === 0) {
      return;
    }

    const queued = [...messageQueueRef.current];
    messageQueueRef.current = [];

    queued.forEach((payload) => {
      try {
        ws.send(JSON.stringify(payload));
      } catch (sendError) {
        console.warn('useVoiceRoom: не удалось отправить отложенное сообщение', sendError);
      }
    });
  }, []);

  const sendSignal = useCallback(
    (payload) => {
      const ws = wsRef.current;

      if (ws && ws.readyState === WebSocket.OPEN) {
        flushMessageQueue();

        try {
          ws.send(JSON.stringify(payload));
          return true;
        } catch (sendError) {
          console.warn('useVoiceRoom: ошибка отправки сообщения по WebSocket', sendError);
          return false;
        }
      }

      messageQueueRef.current.push(payload);
      return false;
    },
    [flushMessageQueue]
  );

  const stopCallTimer = useCallback(() => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  }, []);

  const startCallTimer = useCallback(() => {
    stopCallTimer();

    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  }, [stopCallTimer]);

  const stopSpeakingMonitor = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (closeError) {
        console.warn('useVoiceRoom: ошибка закрытия AudioContext', closeError);
      }
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    analyserDataRef.current = null;
    lastSpeakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const updateSpeakingUsers = useCallback((userId, speaking) => {
    if (!userId) {
      return;
    }

    setSpeakingUsers((prev) => {
      const next = new Set(prev);
      if (speaking) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });

    setParticipants((prev) =>
      prev.map((participant) =>
        participant.id === userId ? { ...participant, is_speaking: speaking } : participant
      )
    );
  }, []);

  const startSpeakingMonitor = useCallback(
    (stream) => {
      stopSpeakingMonitor();

      const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextImpl) {
        console.warn('useVoiceRoom: AudioContext недоступен в этом браузере');
        return;
      }

      try {
        const context = new AudioContextImpl();
        const analyser = context.createAnalyser();
        const source = context.createMediaStreamSource(stream);

        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        audioContextRef.current = context;
        analyserRef.current = analyser;
        analyserDataRef.current = dataArray;

        const analyze = () => {
          if (!analyserRef.current || !analyserDataRef.current) {
            return;
          }

          analyserRef.current.getByteFrequencyData(analyserDataRef.current);
          const averageLevel =
            analyserDataRef.current.reduce((sum, value) => sum + value, 0) /
            analyserDataRef.current.length;

          const speaking = averageLevel > SPEAKING_THRESHOLD;
          setIsSpeaking(speaking);

          if (speaking !== lastSpeakingRef.current) {
            lastSpeakingRef.current = speaking;
            if (currentUserId) {
              sendSignal({
                type: 'speaking_status',
                user_id: currentUserId,
                is_speaking: speaking
              });
              updateSpeakingUsers(currentUserId, speaking);
            }
          }

          animationRef.current = requestAnimationFrame(analyze);
        };

        animationRef.current = requestAnimationFrame(analyze);
      } catch (analysisError) {
        console.error('useVoiceRoom: не удалось запустить анализатор звука', analysisError);
        stopSpeakingMonitor();
      }
    },
    [currentUserId, sendSignal, stopSpeakingMonitor, updateSpeakingUsers]
  );

  const ensureLocalStream = useCallback(async () => {
    if (localStream) {
      return localStream;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      setLocalStream(stream);
      setIsMuted(false);
      startSpeakingMonitor(stream);
      return stream;
    } catch (mediaError) {
      console.error('useVoiceRoom: не удалось получить доступ к микрофону', mediaError);
      throw mediaError;
    }
  }, [localStream, startSpeakingMonitor]);

  const attachLocalTracks = useCallback(
    (pc) => {
      if (!localStream) {
        return;
      }

      const attachedTrackIds = new Set(
        pc
          .getSenders()
          .map((sender) => sender.track?.id)
          .filter(Boolean)
      );

      localStream.getAudioTracks().forEach((track) => {
        if (!attachedTrackIds.has(track.id)) {
          try {
            pc.addTrack(track, localStream);
          } catch (attachError) {
            console.warn('useVoiceRoom: не удалось добавить локальный трек', attachError);
          }
        }
      });
    },
    [localStream]
  );

  const teardownPeer = useCallback((peerId) => {
    const entry = peersRef.current.get(peerId);
    if (entry) {
      peersRef.current.delete(peerId);

      try {
        entry.pc.onnegotiationneeded = null;
        entry.pc.onicecandidate = null;
        entry.pc.ontrack = null;
        entry.pc.onconnectionstatechange = null;
        entry.pc.oniceconnectionstatechange = null;
        entry.pc.close();
      } catch (closeError) {
        console.warn('useVoiceRoom: ошибка закрытия PeerConnection', closeError);
      }
    }

    pendingCandidatesRef.current.delete(peerId);

    setRemoteStreams((prev) => {
      if (!prev.has(peerId)) {
        return prev;
      }
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });

    setSpeakingUsers((prev) => {
      if (!prev.has(peerId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  const negotiateWithPeer = useCallback(
    async (peerId, pc) => {
      if (!peerId || !pc || pc.connectionState === 'closed' || !localStream) {
        return;
      }

      try {
        makingOfferRef.current.add(peerId);
        const offer = await pc.createOffer();
        if (pc.connectionState === 'closed') {
          return;
        }
        await pc.setLocalDescription(offer);
        sendSignal({
          type: 'webrtc_offer',
          to: peerId,
          offer
        });
      } catch (offerError) {
        console.error('useVoiceRoom: ошибка создания offer', offerError);
      } finally {
        makingOfferRef.current.delete(peerId);
      }
    },
    [localStream, sendSignal]
  );

  const ensurePeer = useCallback(
    (peerId) => {
      if (!peerId || peerId === currentUserId) {
        return null;
      }

      let entry = peersRef.current.get(peerId);
      if (entry) {
        attachLocalTracks(entry.pc);
        return entry;
      }

      const polite = currentUserId ? currentUserId.localeCompare(peerId) < 0 : true;
      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10
      });

      entry = { pc, polite };
      peersRef.current.set(peerId, entry);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({
            type: 'webrtc_ice_candidate',
            to: peerId,
            candidate: event.candidate
          });
        }
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) {
          return;
        }

        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(peerId, stream);
          return next;
        });
      };

      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) {
          teardownPeer(peerId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          teardownPeer(peerId);
        }
      };

      pc.onnegotiationneeded = async () => {
        await negotiateWithPeer(peerId, pc);
      };

      attachLocalTracks(pc);

      Promise.resolve().then(() => {
        const storedEntry = peersRef.current.get(peerId);
        if (
          storedEntry?.pc === pc &&
          pc.connectionState !== 'closed' &&
          pc.signalingState === 'stable' &&
          !makingOfferRef.current.has(peerId)
        ) {
          negotiateWithPeer(peerId, pc);
        }
      });

      return entry;
    },
    [attachLocalTracks, currentUserId, negotiateWithPeer, teardownPeer]
  );

  const flushCandidateQueue = useCallback(async (peerId) => {
    const entry = peersRef.current.get(peerId);
    if (!entry) {
      return;
    }

    const pc = entry.pc;
    const queued = pendingCandidatesRef.current.get(peerId);

    if (!queued || !queued.length || !pc.remoteDescription) {
      return;
    }

    while (queued.length) {
      const candidate = queued.shift();
      try {
        await pc.addIceCandidate(candidate);
      } catch (candidateError) {
        console.warn('useVoiceRoom: не удалось добавить отложенный ICE candidate', candidateError);
      }
    }

    if (queued.length === 0) {
      pendingCandidatesRef.current.delete(peerId);
    }
  }, []);

  const handleOffer = useCallback(
    async (peerId, offerPayload) => {
      if (!peerId || !offerPayload) {
        return;
      }

      const entry = ensurePeer(peerId);
      if (!entry) {
        return;
      }

      const { pc, polite } = entry;

      try {
        const offer = new RTCSessionDescription(offerPayload);
        const offerCollision =
          makingOfferRef.current.has(peerId) || pc.signalingState !== 'stable';

        if (offerCollision && !polite) {
          return;
        }

        if (offerCollision) {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(offer)
          ]);
        } else {
          await pc.setRemoteDescription(offer);
        }

        attachLocalTracks(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({
          type: 'webrtc_answer',
          to: peerId,
          answer
        });
        await flushCandidateQueue(peerId);
      } catch (offerError) {
        console.error('useVoiceRoom: ошибка обработки offer', offerError);
      }
    },
    [attachLocalTracks, ensurePeer, flushCandidateQueue, sendSignal]
  );

  const handleAnswer = useCallback(
    async (peerId, answerPayload) => {
      if (!peerId || !answerPayload) {
        return;
      }

      const entry = peersRef.current.get(peerId);
      if (!entry) {
        return;
      }

      try {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(answerPayload));
        await flushCandidateQueue(peerId);
      } catch (answerError) {
        console.error('useVoiceRoom: ошибка обработки answer', answerError);
      }
    },
    [flushCandidateQueue]
  );

  const handleIceCandidate = useCallback((peerId, candidatePayload) => {
    if (!peerId || !candidatePayload) {
      return;
    }

    const candidate = new RTCIceCandidate(candidatePayload);
    const entry = peersRef.current.get(peerId);

    if (entry && entry.pc.remoteDescription) {
      entry.pc.addIceCandidate(candidate).catch((candidateError) => {
        console.error('useVoiceRoom: ошибка добавления ICE candidate', candidateError);
      });
      return;
    }

    if (!pendingCandidatesRef.current.has(peerId)) {
      pendingCandidatesRef.current.set(peerId, []);
    }

    pendingCandidatesRef.current.get(peerId).push(candidate);
  }, []);

  const handleUserLeft = useCallback(
    (userId) => {
      if (!userId) {
        return;
      }

      setParticipants((prev) => prev.filter((participant) => participant.id !== userId));
      updateSpeakingUsers(userId, false);
      teardownPeer(userId);
    },
    [teardownPeer, updateSpeakingUsers]
  );

  const applyParticipants = useCallback(
    (incoming = [], options = {}) => {
      const { replace = false } = options;
      const normalized = incoming
        .map((participant) => normalizeParticipant(participant))
        .filter(Boolean);

      setParticipants((prev) => {
        const map = new Map();

        if (!replace) {
          prev.forEach((participant) => {
            if (participant?.id) {
              map.set(participant.id, participant);
            }
          });
        }

        normalized.forEach((participant) => {
          if (!participant?.id) {
            return;
          }

          const existing = map.get(participant.id) || {};
          map.set(participant.id, { ...existing, ...participant });
        });

        if (currentUserId) {
          const selfParticipant = normalizeParticipant(currentUser, currentUserId);
          if (selfParticipant) {
            const existing = map.get(currentUserId) || {};
            map.set(currentUserId, {
              ...existing,
              ...selfParticipant,
              is_speaking: existing.is_speaking ?? isSpeaking
            });
          }
        }

        const next = Array.from(map.values());
        next.sort((a, b) => {
          if (a.joined_at && b.joined_at && a.joined_at !== b.joined_at) {
            return a.joined_at - b.joined_at;
          }
          return String(a.id).localeCompare(String(b.id));
        });

        return next;
      });

      if (replace) {
        setSpeakingUsers(() => {
          const speaking = new Set();
          normalized.forEach((participant) => {
            if (participant?.id && participant.is_speaking) {
              speaking.add(participant.id);
            }
          });

          if (currentUserId && (isSpeaking || speaking.has(currentUserId))) {
            speaking.add(currentUserId);
          }

          return speaking;
        });
      } else if (normalized.length) {
        setSpeakingUsers((prev) => {
          const speaking = new Set(prev);

          normalized.forEach((participant) => {
            if (!participant?.id) {
              return;
            }

            if (participant.is_speaking) {
              speaking.add(participant.id);
            } else {
              speaking.delete(participant.id);
            }
          });

          return speaking;
        });
      }
    },
    [currentUser, currentUserId, isSpeaking]
  );

  const handleMessage = useCallback(
    (event) => {
      let message;

      try {
        message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch (parseError) {
        console.error('useVoiceRoom: не удалось разобрать сообщение WebSocket', parseError);
        return;
      }

      const senderId = extractParticipantId(message);

      switch (message.type) {
        case 'participants_update':
          if (Array.isArray(message.participants)) {
            applyParticipants(message.participants, { replace: true });
          }
          break;
        case 'user_joined':
          if (message.user) {
            applyParticipants([message.user]);
          }
          break;
        case 'user_left':
          handleUserLeft(message.user_id || message.id || message.userId || senderId);
          break;
        case 'speaking_status':
          updateSpeakingUsers(
            message.user_id || message.id || message.userId || senderId,
            Boolean(message.is_speaking)
          );
          break;
        case 'webrtc_offer':
          handleOffer(senderId, message.offer || message.description);
          break;
        case 'webrtc_answer':
          handleAnswer(senderId, message.answer || message.description);
          break;
        case 'webrtc_ice_candidate':
          handleIceCandidate(senderId, message.candidate);
          break;
        default:
          break;
      }
    },
    [
      applyParticipants,
      handleAnswer,
      handleIceCandidate,
      handleOffer,
      handleUserLeft,
      updateSpeakingUsers
    ]
  );

  const fetchParticipants = useCallback(async () => {
    if (!roomId) {
      return [];
    }

    const response = await fetch(`${apiOrigin}/api/rooms/${roomId}`);
    if (!response.ok) {
      throw new Error(`Не удалось получить участников комнаты (${response.status})`);
    }

    const data = await response.json();
    const participantsData = data?.room?.participants || [];
    return participantsData.map((participant) => normalizeParticipant(participant)).filter(Boolean);
  }, [apiOrigin, roomId]);

  const leaveRoom = useCallback(() => {
    intentionalLeaveRef.current = true;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (closeError) {
        console.warn('useVoiceRoom: ошибка закрытия WebSocket', closeError);
      }
      wsRef.current = null;
    }

    const peerIds = Array.from(peersRef.current.keys());
    peerIds.forEach((peerId) => teardownPeer(peerId));
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }

    stopCallTimer();
    stopSpeakingMonitor();

    setIsInRoom(false);
    setIsConnecting(false);
    setIsInCall(false);
    setCallDuration(0);
    setParticipants([]);
    setRemoteStreams(new Map());
    setSpeakingUsers(new Set());
    setIsSpeaking(false);
    setIsMuted(false);
    setError(null);
    messageQueueRef.current = [];
    lastSpeakingRef.current = false;
  }, [localStream, stopCallTimer, stopSpeakingMonitor, teardownPeer]);

  const connectWebSocket = useCallback(
    (userId) => {
      if (!roomId || !userId) {
        return Promise.reject(new Error('Не указан идентификатор комнаты или пользователя'));
      }

      const baseUrl = new URL(apiOrigin);
      const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${baseUrl.host}/ws/${roomId}/${userId}`;

      return new Promise((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        const cleanupHandlers = () => {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
        };

        ws.onopen = () => {
          settled = true;
          setIsInRoom(true);
          setError(null);
          flushMessageQueue();

          try {
            ws.send(
              JSON.stringify({
                type: 'user_joined',
                user_id: userId,
                user_name: currentUser?.name
              })
            );
          } catch (announceError) {
            console.warn('useVoiceRoom: не удалось отправить событие user_joined', announceError);
          }

          resolve();
        };

        ws.onmessage = (event) => {
          handleMessage(event);
        };

        ws.onerror = () => {
          if (!settled) {
            settled = true;
            cleanupHandlers();
            try {
              ws.close();
            } catch (closeError) {
              console.warn('useVoiceRoom: ошибка закрытия WebSocket после ошибки', closeError);
            }
            reject(new Error('Не удалось подключиться к комнате'));
          } else if (!intentionalLeaveRef.current) {
            setError('Ошибка соединения с комнатой');
          }
        };

        ws.onclose = () => {
          cleanupHandlers();
          if (wsRef.current === ws) {
            wsRef.current = null;
          }

          setIsInRoom(false);
          setIsConnecting(false);
          stopCallTimer();
          setIsInCall(false);
          setCallDuration(0);

          const peerIds = Array.from(peersRef.current.keys());
          peerIds.forEach((peerId) => teardownPeer(peerId));
          pendingCandidatesRef.current.clear();
          setRemoteStreams(new Map());
          setSpeakingUsers(new Set());

          if (!settled) {
            settled = true;
            reject(new Error('Соединение было закрыто'));
            return;
          }

          if (!intentionalLeaveRef.current) {
            setError('Соединение с комнатой потеряно. Попробуйте подключиться снова.');
          }
        };
      });
    },
    [apiOrigin, currentUser?.name, flushMessageQueue, handleMessage, roomId, stopCallTimer, teardownPeer]
  );

  const joinRoom = useCallback(async () => {
    if (!roomId || !currentUserId || !isAuthenticated || isInRoom || isConnecting) {
      return;
    }

    intentionalLeaveRef.current = false;
    setIsConnecting(true);

    try {
      await ensureLocalStream();
      const existingParticipants = await fetchParticipants();
      applyParticipants(existingParticipants, { replace: true });
      await connectWebSocket(currentUserId);
    } catch (joinError) {
      setError(joinError.message || 'Не удалось подключиться к комнате');
      intentionalLeaveRef.current = true;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (closeError) {
          console.warn('useVoiceRoom: ошибка закрытия WebSocket после неудачного подключения', closeError);
        }
        wsRef.current = null;
      }
      throw joinError;
    } finally {
      setIsConnecting(false);
    }
  }, [
    applyParticipants,
    connectWebSocket,
    currentUserId,
    ensureLocalStream,
    fetchParticipants,
    isAuthenticated,
    isConnecting,
    isInRoom,
    roomId
  ]);

  const toggleMute = useCallback(() => {
    if (!localStream) {
      return false;
    }

    const nextMuted = !isMuted;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
    return nextMuted;
  }, [isMuted, localStream]);

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn((prev) => !prev);
  }, []);

  const startCall = useCallback(() => {
    if (isInCall) {
      return;
    }

    setIsInCall(true);
    setCallDuration(0);
    startCallTimer();

    if (currentUserId) {
      sendSignal({ type: 'call_started', user_id: currentUserId });
    }
  }, [currentUserId, isInCall, sendSignal, startCallTimer]);

  const endCall = useCallback(() => {
    if (!isInCall) {
      return;
    }

    setIsInCall(false);
    setCallDuration(0);
    stopCallTimer();

    if (currentUserId) {
      sendSignal({ type: 'call_ended', user_id: currentUserId });
    }
  }, [currentUserId, isInCall, sendSignal, stopCallTimer]);

  useEffect(() => {
    if (!localStream) {
      return;
    }

    peersRef.current.forEach((entry) => {
      attachLocalTracks(entry.pc);
    });
  }, [attachLocalTracks, localStream]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const remoteIds = new Set();
    participants.forEach((participant) => {
      if (participant.id && participant.id !== currentUserId) {
        remoteIds.add(participant.id);
        ensurePeer(participant.id);
      }
    });

    peersRef.current.forEach((_, peerId) => {
      if (!remoteIds.has(peerId)) {
        teardownPeer(peerId);
      }
    });
  }, [currentUserId, ensurePeer, participants, teardownPeer]);

  useEffect(() => {
    if (!isInCall) {
      stopCallTimer();
    }
  }, [isInCall, stopCallTimer]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      leaveRoom();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [leaveRoom]);

  useEffect(() => () => {
    leaveRoom();
  }, [leaveRoom]);

  return {
    localStream,
    remoteStreams,
    participants,
    speakingUsers,
    isMuted,
    isSpeakerOn,
    isInRoom,
    isInCall,
    callDuration,
    isSpeaking,
    error,
    isConnecting,
    joinRoom,
    leaveRoom,
    startCall,
    endCall,
    toggleMute,
    toggleSpeaker
  };
};

export default useVoiceRoom;
