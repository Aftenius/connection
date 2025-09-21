import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Users,
  Volume2,
  VolumeX
} from 'lucide-react';
import CookieSessionManager from '../utils/CookieSessionManager';
import useVoiceRoom from '../hooks/useVoiceRoom';

const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

const AudioMeetingRoom = ({ title = 'Аудио-встреча' }) => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const sessionManager = useMemo(() => new CookieSessionManager(), []);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [sessionError, setSessionError] = useState(null);

  const remoteAudioRefs = useRef(new Map());

  const {
    participants,
    remoteStreams,
    speakingUsers,
    isMuted,
    isSpeakerOn,
    isInCall,
    callDuration,
    isSpeaking,
    error: roomError,
    isInRoom,
    isConnecting,
    joinRoom,
    leaveRoom,
    startCall,
    endCall,
    toggleMute,
    toggleSpeaker
  } = useVoiceRoom({ roomId, currentUser, isAuthenticated });

  const currentUserId = currentUser?.id || currentUser?.user_id || currentUser?.userId;

  const remoteParticipants = participants.filter(
    (participant) => participant.id && participant.id !== currentUserId
  );

  const registerRemoteAudio = useCallback(
    (userId) => (element) => {
      if (!element) {
        remoteAudioRefs.current.delete(userId);
        return;
      }

      remoteAudioRefs.current.set(userId, element);

      const stream = remoteStreams.get(userId);
      if (stream && element.srcObject !== stream) {
        element.srcObject = stream;
        const playPromise = element.play?.();
        if (playPromise?.catch) {
          playPromise.catch(() => {});
        }
      }
      element.volume = isSpeakerOn ? 1 : 0;
      element.muted = false;
    },
    [isSpeakerOn, remoteStreams]
  );

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        const hasValidSession = await sessionManager.hasValidSession();
        if (!hasValidSession) {
          const fallbackName = `Пользователь_${Math.floor(Math.random() * 1000)}`;
          const user = await sessionManager.createOrRestoreSession(fallbackName);
          if (!cancelled) {
            setCurrentUser(user);
            setIsAuthenticated(true);
            setSessionError(null);
          }
          return;
        }

        const user = await sessionManager.getCurrentUser();
        if (!user) {
          throw new Error('Сессия найдена, но пользователь не определен');
        }

        if (!cancelled) {
          setCurrentUser(user);
          setIsAuthenticated(true);
          setSessionError(null);
        }
      } catch (restoreError) {
        console.error('AudioMeetingRoom: не удалось восстановить сессию', restoreError);
        if (!cancelled) {
          setSessionError('Не удалось восстановить сессию пользователя');
        }
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [sessionManager]);

  useEffect(() => {
    if (
      !roomId ||
      !isAuthenticated ||
      !currentUser ||
      !currentUserId ||
      isInRoom ||
      isConnecting
    ) {
      return;
    }

    let cancelled = false;

    joinRoom().catch((joinError) => {
      if (cancelled) {
        return;
      }

      console.error('AudioMeetingRoom: не удалось подключиться к комнате', joinError);
      alert('Не удалось подключиться к комнате. Попробуйте еще раз.');
      navigate('/');
    });

    return () => {
      cancelled = true;
    };
  }, [
    currentUser,
    currentUserId,
    isAuthenticated,
    isConnecting,
    isInRoom,
    joinRoom,
    navigate,
    roomId
  ]);

  useEffect(() => {
    remoteStreams.forEach((stream, userId) => {
      const audioElement = remoteAudioRefs.current.get(userId);
      if (audioElement && audioElement.srcObject !== stream) {
        audioElement.srcObject = stream;
        const playPromise = audioElement.play?.();
        if (playPromise?.catch) {
          playPromise.catch(() => {});
        }
      }
    });

    remoteAudioRefs.current.forEach((audioElement, userId) => {
      if (!remoteStreams.has(userId) && audioElement.srcObject) {
        audioElement.srcObject = null;
        audioElement.pause?.();
      }
    });
  }, [remoteStreams]);

  useEffect(() => {
    remoteAudioRefs.current.forEach((audioElement) => {
      audioElement.volume = isSpeakerOn ? 1 : 0;
    });
  }, [isSpeakerOn]);

  useEffect(() => () => {
    leaveRoom();
  }, [leaveRoom]);

  const handleLeaveRoom = useCallback(() => {
    leaveRoom();
    navigate('/');
  }, [leaveRoom, navigate]);

  const renderErrorBanner = () => {
    const message = roomError || sessionError;
    if (!message) {
      return null;
    }

    return (
      <div className="mb-4 rounded-lg border border-red-500 bg-red-900/30 px-4 py-3 text-sm text-red-200">
        {message}
      </div>
    );
  };

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-white">
      <header className="border-b border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-sm text-gray-400">Комната: {roomId}</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm text-gray-300">
              <Users className="h-4 w-4" />
              <span>{remoteParticipants.length + 1} участников</span>
            </div>
            <button
              onClick={handleLeaveRoom}
              className="flex items-center space-x-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-700"
            >
              <PhoneOff className="h-4 w-4" />
              <span>Покинуть</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          {renderErrorBanner()}

          <div className="mb-6 rounded-xl border border-gray-800 bg-gray-800 p-6">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-blue-600 text-3xl font-bold">
                {currentUser?.name?.charAt(0)?.toUpperCase() || 'U'}
                {isSpeaking && (
                  <span className="absolute -right-2 -top-2 rounded-full bg-green-500 px-2 py-1 text-xs font-semibold text-black">
                    Говорит
                  </span>
                )}
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold">{currentUser?.name || 'Вы'}</div>
                <div className="text-sm text-gray-400">
                  {isInCall ? `В звонке ${formatDuration(callDuration)}` : 'Готов к звонку'}
                </div>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={toggleMute}
                  className={`flex items-center space-x-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                    isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  <span>{isMuted ? 'Включить микрофон' : 'Выключить микрофон'}</span>
                </button>
                <button
                  onClick={toggleSpeaker}
                  className={`flex items-center space-x-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                    isSpeakerOn ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {isSpeakerOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  <span>{isSpeakerOn ? 'Динамик включен' : 'Динамик выключен'}</span>
                </button>
                <button
                  onClick={isInCall ? endCall : startCall}
                  disabled={isConnecting || (!isInCall && !isInRoom)}
                  className={`flex items-center space-x-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                    isInCall
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-green-600 hover:bg-green-700'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isInCall ? <PhoneOff className="h-4 w-4" /> : <PhoneCall className="h-4 w-4" />}
                  <span>{isInCall ? 'Завершить' : 'Начать'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {remoteParticipants.map((participant) => {
              const speaking = speakingUsers.has(participant.id);

              return (
                <div
                  key={participant.id}
                  className="relative rounded-xl border border-gray-800 bg-gray-800 p-6 text-center"
                >
                  <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-purple-600 text-2xl font-bold">
                    {participant.name?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <div className="text-lg font-semibold">{participant.name || 'Участник'}</div>
                  <div className="mt-1 text-sm text-gray-400">Подключен</div>
                  {speaking && (
                    <div className="absolute right-4 top-4 rounded-full bg-green-500 px-2 py-1 text-xs font-semibold text-black">
                      Говорит
                    </div>
                  )}
                  <audio
                    ref={registerRemoteAudio(participant.id)}
                    autoPlay
                    playsInline
                    className="hidden"
                  />
                </div>
              );
            })}

            {remoteParticipants.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/60 p-6 text-center text-sm text-gray-400">
                Ожидание других участников…
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AudioMeetingRoom;
