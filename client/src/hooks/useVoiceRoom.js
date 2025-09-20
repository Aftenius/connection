import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' }
];

const AUDIO_THRESHOLD = 40;

const extractParticipantId = (payload, fallback) => {
  return (
    payload?.id ||
    payload?.user_id ||
    payload?.userId ||
    payload?.from ||
    fallback ||
    null
  );
};

const normalizeParticipant = (participant, fallbackId) => {
  if (!participant && !fallbackId) {
    return null;
  }

  const data = { ...(participant || {}) };
  const participantId = extractParticipantId(data, fallbackId);

  if (!participantId) {
    return null;
  }

  const name =
    data.name ||
    data.user_name ||
    data.username ||
    `Участник ${String(participantId).slice(0, 6)}`;

  return {
    id: participantId,
    user_id: participantId,
    name,
    is_creator: Boolean(data.is_creator),
    is_speaking: Boolean(data.is_speaking),
    joined_at: data.joined_at || Date.now()
  };
};

export const useVoiceRoom = ({ roomId, currentUser, isAuthenticated }) => {
  const [localStream, setLocalStream] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isInRoom, setIsInRoom] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const wsRef = useRef(null);
  const peerConnections = useRef(new Map());
  const makingOfferRef = useRef(new Map());
  const pendingCandidates = useRef(new Map());
  const callTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const analyserDataRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastSpeakingStateRef = useRef(false);

  const apiOrigin = useMemo(() => {
    const raw = process.env.REACT_APP_API_URL || window.location.origin;
    try {
      return new URL(raw).origin;
    } catch (error) {
      console.warn('useVoiceRoom: Не удалось разобрать REACT_APP_API_URL, используем window.location.origin');
      return window.location.origin;
    }
  }, []);

  const currentUserId = currentUser?.id || currentUser?.user_id || currentUser?.userId;

  const resetSpeakingAnalysis = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (error) {
        console.warn('useVoiceRoom: Ошибка закрытия AudioContext', error);
      }
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    analyserDataRef.current = null;
    lastSpeakingStateRef.current = false;
    setIsSpeaking(false);
  }, []);

  const sendWebSocketMessage = useCallback((payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const updateSpeakingState = useCallback((speaking) => {
    setIsSpeaking(speaking);

    if (lastSpeakingStateRef.current !== speaking) {
      lastSpeakingStateRef.current = speaking;

      if (currentUserId) {
        sendWebSocketMessage({
          type: 'speaking_status',
          user_id: currentUserId,
          is_speaking: speaking
        });
      }
    }
  }, [currentUserId, sendWebSocketMessage]);

  const startSpeakingAnalysis = useCallback((stream) => {
    resetSpeakingAnalysis();

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
        const average = analyserDataRef.current.reduce((sum, value) => sum + value, 0) /
          analyserDataRef.current.length;

        updateSpeakingState(average > AUDIO_THRESHOLD);
        animationFrameRef.current = requestAnimationFrame(analyze);
      };

      animationFrameRef.current = requestAnimationFrame(analyze);
    } catch (analysisError) {
      console.error('useVoiceRoom: Не удалось запустить анализатор звука', analysisError);
      resetSpeakingAnalysis();
    }
  }, [resetSpeakingAnalysis, updateSpeakingState]);

  const ensureLocalStream = useCallback(async () => {
    if (localStream) {
      return localStream;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    setLocalStream(stream);
    startSpeakingAnalysis(stream);
    return stream;
  }, [localStream, startSpeakingAnalysis]);

  const attachLocalTracks = useCallback((pc) => {
    if (!localStream) {
      return;
    }

    const existingTrackIds = new Set(
      pc.getSenders()
        .map((sender) => sender.track?.id)
        .filter(Boolean)
    );

    localStream.getAudioTracks().forEach((track) => {
      if (!existingTrackIds.has(track.id)) {
        try {
          pc.addTrack(track, localStream);
        } catch (error) {
          console.warn('useVoiceRoom: Не удалось добавить локальный трек', error);
        }
      }
    });
  }, [localStream]);

  const closePeerConnection = useCallback((peerId) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch (error) {
        console.warn('useVoiceRoom: Ошибка закрытия PeerConnection', error);
      }
      peerConnections.current.delete(peerId);
    }

    makingOfferRef.current.delete(peerId);
    pendingCandidates.current.delete(peerId);

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

  const flushPendingCandidates = useCallback(async (peerId, pc) => {
    const queued = pendingCandidates.current.get(peerId);
    if (!queued || !queued.length || !pc.remoteDescription) {
      return;
    }

    while (queued.length) {
      const candidate = queued.shift();
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn('useVoiceRoom: Не удалось добавить отложенный ICE candidate', error);
      }
    }
  }, []);

  const getOrCreatePeerConnection = useCallback((peerId) => {
    if (!peerId) {
      return null;
    }

    let pc = peerConnections.current.get(peerId);
    if (pc) {
      attachLocalTracks(pc);
      return pc;
    }

    pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10
    });

    peerConnections.current.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWebSocketMessage({
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
        closePeerConnection(peerId);
      }
    };

    attachLocalTracks(pc);
    return pc;
  }, [attachLocalTracks, closePeerConnection, sendWebSocketMessage]);

  const shouldInitiateOffer = useCallback((peerId) => {
    if (!currentUserId || !peerId) {
      return false;
    }

    return currentUserId.localeCompare(peerId) > 0;
  }, [currentUserId]);

  const negotiateWithPeer = useCallback(async (peerId) => {
    if (!localStream || !shouldInitiateOffer(peerId)) {
      return;
    }

    const pc = getOrCreatePeerConnection(peerId);
    if (!pc || pc.signalingState !== 'stable' || makingOfferRef.current.get(peerId)) {
      return;
    }

    try {
      makingOfferRef.current.set(peerId, true);
      attachLocalTracks(pc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWebSocketMessage({
        type: 'webrtc_offer',
        to: peerId,
        offer
      });
    } catch (error) {
      console.error('useVoiceRoom: Ошибка создания offer', error);
    } finally {
      makingOfferRef.current.set(peerId, false);
    }
  }, [attachLocalTracks, getOrCreatePeerConnection, localStream, sendWebSocketMessage, shouldInitiateOffer]);

  const handleOffer = useCallback(async (message) => {
    const peerId = extractParticipantId(message);
    if (!peerId) {
      return;
    }

    const pc = getOrCreatePeerConnection(peerId);
    if (!pc) {
      return;
    }

    const polite = currentUserId ? currentUserId.localeCompare(peerId) < 0 : true;
    const offerCollision = makingOfferRef.current.get(peerId) || pc.signalingState !== 'stable';

    try {
      const offerDesc = new RTCSessionDescription(message.offer);

      if (offerCollision) {
        if (!polite) {
          console.warn('useVoiceRoom: Игнорируем конфликтующий offer от', peerId);
          return;
        }

        await Promise.all([
          pc.setLocalDescription({ type: 'rollback' }),
          pc.setRemoteDescription(offerDesc)
        ]);
      } else {
        await pc.setRemoteDescription(offerDesc);
      }

      attachLocalTracks(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendWebSocketMessage({
        type: 'webrtc_answer',
        to: peerId,
        answer
      });

      await flushPendingCandidates(peerId, pc);
    } catch (error) {
      console.error('useVoiceRoom: Ошибка обработки offer', error);
    }
  }, [attachLocalTracks, currentUserId, flushPendingCandidates, getOrCreatePeerConnection, sendWebSocketMessage]);

  const handleAnswer = useCallback(async (message) => {
    const peerId = extractParticipantId(message);
    if (!peerId) {
      return;
    }

    const pc = peerConnections.current.get(peerId);
    if (!pc) {
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
      await flushPendingCandidates(peerId, pc);
    } catch (error) {
      console.error('useVoiceRoom: Ошибка обработки answer', error);
    }
  }, [flushPendingCandidates]);

  const handleIceCandidate = useCallback(async (message) => {
    const peerId = extractParticipantId(message);
    if (!peerId || !message.candidate) {
      return;
    }

    const candidate = new RTCIceCandidate(message.candidate);
    const pc = peerConnections.current.get(peerId);

    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error('useVoiceRoom: Ошибка добавления ICE candidate', error);
      }
    } else {
      if (!pendingCandidates.current.has(peerId)) {
        pendingCandidates.current.set(peerId, []);
      }
      pendingCandidates.current.get(peerId).push(candidate);
    }
  }, []);

  const applyParticipants = useCallback((incoming = []) => {
    const normalized = incoming
      .map((participant) => normalizeParticipant(participant))
      .filter(Boolean);

    setParticipants((prev) => {
      const map = new Map();

      normalized.forEach((participant) => {
        map.set(participant.id, participant);
      });

      prev.forEach((participant) => {
        if (!map.has(participant.id)) {
          map.set(participant.id, participant);
        }
      });

      if (currentUserId) {
        const normalizedCurrent = normalizeParticipant(currentUser, currentUserId);
        if (normalizedCurrent) {
          map.set(currentUserId, normalizedCurrent);
        }
      }

      return Array.from(map.values());
    });
  }, [currentUser, currentUserId]);

  const handleUserLeft = useCallback((userId) => {
    if (!userId) {
      return;
    }

    setParticipants((prev) => prev.filter((participant) => participant.id !== userId));

    setSpeakingUsers((prev) => {
      if (!prev.has(userId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });

    closePeerConnection(userId);
  }, [closePeerConnection]);

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

    setParticipants((prev) => prev.map((participant) => (
      participant.id === userId ? { ...participant, is_speaking: speaking } : participant
    )));
  }, []);

  const handleWebSocketMessage = useCallback((rawMessage) => {
    let message;
    try {
      message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
    } catch (parseError) {
      console.error('useVoiceRoom: Не удалось разобрать сообщение WebSocket', parseError);
      return;
    }

    switch (message.type) {
      case 'participants_update':
        if (Array.isArray(message.participants)) {
          applyParticipants(message.participants);
        }
        break;
      case 'user_joined':
        if (message.user) {
          applyParticipants([message.user]);
        }
        break;
      case 'user_left':
        handleUserLeft(extractParticipantId(message));
        break;
      case 'speaking_status':
        updateSpeakingUsers(extractParticipantId(message), Boolean(message.is_speaking));
        break;
      case 'webrtc_offer':
        handleOffer(message);
        break;
      case 'webrtc_answer':
        handleAnswer(message);
        break;
      case 'webrtc_ice_candidate':
        handleIceCandidate(message);
        break;
      default:
        break;
    }
  }, [applyParticipants, handleAnswer, handleIceCandidate, handleOffer, handleUserLeft, updateSpeakingUsers]);

  const connectWebSocket = useCallback((userId) => {
    if (!roomId || !userId) {
      return;
    }

    const baseUrl = new URL(apiOrigin);
    const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${baseUrl.host}/ws/${roomId}/${userId}`;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (error) {
        console.warn('useVoiceRoom: Ошибка закрытия предыдущего WebSocket', error);
      }
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setError(null);
      if (currentUserId) {
        ws.send(JSON.stringify({
          type: 'user_joined',
          user_id: currentUserId,
          user_name: currentUser?.name
        }));
      }
    };

    ws.onmessage = (event) => {
      handleWebSocketMessage(event.data);
    };

    ws.onerror = (event) => {
      console.error('useVoiceRoom: Ошибка WebSocket', event);
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, [apiOrigin, currentUser?.name, currentUserId, handleWebSocketMessage, roomId]);

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

  const joinRoom = useCallback(async () => {
    if (!roomId || !currentUserId || !isAuthenticated || isInRoom || isConnecting) {
      return;
    }

    setIsConnecting(true);

    try {
      await ensureLocalStream();
      const existingParticipants = await fetchParticipants();
      applyParticipants(existingParticipants);
      connectWebSocket(currentUserId);
      setIsInRoom(true);
    } catch (joinError) {
      console.error('useVoiceRoom: Ошибка присоединения к комнате', joinError);
      setError(joinError.message || 'Не удалось подключиться к комнате');
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

  const leaveRoom = useCallback(() => {
    peerConnections.current.forEach((pc, peerId) => {
      try {
        pc.close();
      } catch (error) {
        console.warn('useVoiceRoom: Ошибка закрытия соединения', error);
      }
      peerConnections.current.delete(peerId);
    });

    makingOfferRef.current.clear();
    pendingCandidates.current.clear();

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (error) {
        console.warn('useVoiceRoom: Ошибка закрытия WebSocket при выходе', error);
      }
      wsRef.current = null;
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }

    resetSpeakingAnalysis();

    setParticipants([]);
    setRemoteStreams(new Map());
    setSpeakingUsers(new Set());
    setIsMuted(false);
    setIsInRoom(false);
    setIsInCall(false);
    setCallDuration(0);
    setError(null);
  }, [localStream, resetSpeakingAnalysis]);

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
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    if (currentUserId) {
      sendWebSocketMessage({ type: 'call_started', user_id: currentUserId });
    }
  }, [currentUserId, isInCall, sendWebSocketMessage]);

  const endCall = useCallback(() => {
    if (!isInCall) {
      return;
    }

    setIsInCall(false);
    setCallDuration(0);

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    if (currentUserId) {
      sendWebSocketMessage({ type: 'call_ended', user_id: currentUserId });
    }
  }, [currentUserId, isInCall, sendWebSocketMessage]);

  useEffect(() => {
    if (!isInCall && callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  }, [isInCall]);

  useEffect(() => {
    if (!localStream) {
      return;
    }

    peerConnections.current.forEach((pc) => {
      attachLocalTracks(pc);
    });
  }, [attachLocalTracks, localStream]);

  useEffect(() => {
    if (!currentUserId || !localStream) {
      return;
    }

    const remoteIds = new Set();
    participants.forEach((participant) => {
      if (participant.id && participant.id !== currentUserId) {
        remoteIds.add(participant.id);
        negotiateWithPeer(participant.id);
      }
    });

    peerConnections.current.forEach((_, peerId) => {
      if (!remoteIds.has(peerId)) {
        closePeerConnection(peerId);
      }
    });
  }, [closePeerConnection, currentUserId, localStream, negotiateWithPeer, participants]);

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
