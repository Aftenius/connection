import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, Lock, Users, LogOut, Calendar, Clock, Link, User,
  Copy, Trash2, Crown, AlertCircle, Mic, Phone
} from 'lucide-react';

const THEME_COLORS = {
  primary: '#70BD1F',
  primaryHover: '#5fa318',
  primaryLight: '#70BD1F30'
};

const HomePage = ({ 
  sessionManager, 
  isAuthenticated, 
  currentUser, 
  setCurrentUser,
  setIsAuthenticated 
}) => {
  const navigate = useNavigate();
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomMaxParticipants, setNewRoomMaxParticipants] = useState(10);
  const [newRoomRequiresPassword, setNewRoomRequiresPassword] = useState(false);
  const [newRoomHasWaitingRoom, setNewRoomHasWaitingRoom] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [rooms, setRooms] = useState([]);
  const [userRooms, setUserRooms] = useState([]);

  const API_BASE_URL = process.env.REACT_APP_API_URL || window.location.origin;

  useEffect(() => {
    if (isAuthenticated) {
      loadRooms();
      loadUserRooms();
    }
  }, [isAuthenticated]);

  const loadRooms = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms`);
      if (response.ok) {
        const data = await response.json();
        setRooms(data.rooms || []);
      }
    } catch (error) {
      console.error('Ошибка загрузки комнат:', error);
    }
  };

  const loadUserRooms = async () => {
    if (!isAuthenticated) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/rooms`, {
        headers: await sessionManager.getAuthHeadersWithRefresh()
      });
      if (response.ok) {
        const data = await response.json();
        setUserRooms(data.rooms || []);
      }
    } catch (error) {
      console.error('Ошибка загрузки комнат пользователя:', error);
    }
  };

  const createRoom = async () => {
    console.log('🏠 Начинаем создание комнаты...');
    
    if (!newRoomName.trim()) {
      alert('Введите название комнаты');
      return;
    }

    // Проверяем аутентификацию и создаем сессию если нужно
    if (!isAuthenticated || !currentUser) {
      console.log('🔄 Пользователь не аутентифицирован, создаем сессию...');
      try {
        const user = await sessionManager.createOrRestoreSession(newRoomName.trim());
        if (user) {
          setCurrentUser(user);
          setIsAuthenticated(true);
          console.log('✅ Сессия создана для пользователя:', user.name);
        } else {
          alert('Не удалось создать сессию. Попробуйте еще раз.');
          return;
        }
      } catch (error) {
        console.error('❌ Ошибка создания сессии:', error);
        alert('Ошибка создания сессии: ' + error.message);
        return;
      }
    }

    try {
      console.log('📤 Отправляем запрос на создание комнаты:', {
        name: newRoomName,
        max_participants: newRoomMaxParticipants,
        requires_password: newRoomRequiresPassword,
        has_waiting_room: newRoomHasWaitingRoom
      });

      const requestHeaders = await sessionManager.getAuthHeadersWithRefresh();
      console.log('🔑 Заголовки запроса:', requestHeaders);

      const response = await fetch(`${API_BASE_URL}/api/rooms`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          name: newRoomName,
          password: newRoomPassword,
          max_participants: newRoomMaxParticipants,
          requires_password: newRoomRequiresPassword,
          has_waiting_room: newRoomHasWaitingRoom
        })
      });

      console.log('📥 Статус ответа:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Ошибка HTTP:', response.status, errorText);
        
        let errorMessage;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorJson.message || 'Неизвестная ошибка сервера';
        } catch {
          errorMessage = `HTTP ${response.status}: ${errorText}`;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('✅ Комната создана:', data);
      
      // Очищаем поля
      setNewRoomName('');
      setNewRoomPassword('');
      setNewRoomRequiresPassword(false);
      setNewRoomHasWaitingRoom(true);
      
      // Обновляем списки
      await loadRooms();
      await loadUserRooms();
      
      // Перенаправляем на страницу комнаты
      console.log('🚀 Переходим в комнату:', data.room_id);
      navigate(`/room/${data.room_id}`);
      
    } catch (error) {
      console.error('❌ Ошибка создания комнаты:', error);
      alert('Ошибка создания комнаты: ' + error.message);
    }
  };

  const joinRoom = async (roomId) => {
    if (!isAuthenticated) {
      alert('Сначала войдите в систему');
      return;
    }

    // Перенаправляем на страницу комнаты
    navigate(`/room/${roomId}`);
  };

  const joinAudioRoom = async (roomId) => {
    if (!isAuthenticated) {
      alert('Сначала войдите в систему');
      return;
    }

    // Перенаправляем на страницу аудио-комнаты
    navigate(`/audio/${roomId}`);
  };

  const joinRoomByCode = async () => {
    if (!joinCode.trim()) {
      alert('Введите код комнаты');
      return;
    }

    // Проверяем аутентификацию и создаем сессию если нужно
    if (!isAuthenticated || !currentUser) {
      console.log('🔄 Пользователь не аутентифицирован, создаем сессию...');
      try {
        const userName = `Пользователь_${Math.floor(Math.random() * 1000)}`;
        const user = await sessionManager.createOrRestoreSession(userName);
        if (user) {
          setCurrentUser(user);
          setIsAuthenticated(true);
          console.log('✅ Сессия создана для пользователя:', user.name);
        } else {
          alert('Не удалось создать сессию. Попробуйте еще раз.');
          return;
        }
      } catch (error) {
        console.error('❌ Ошибка создания сессии:', error);
        alert('Ошибка создания сессии: ' + error.message);
        return;
      }
    }

    await joinRoom(joinCode);
  };

  const logout = () => {
    sessionManager.clearSession();
    setIsAuthenticated(false);
    setCurrentUser(null);
    setRooms([]);
    setUserRooms([]);
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString('ru-RU');
  };

  const copyRoomCode = (roomId) => {
    navigator.clipboard.writeText(roomId);
    alert('Код комнаты скопирован!');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Заголовок */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Secure Voice</h1>
              <p className="text-gray-600 mt-1">
                Добро пожаловать, {currentUser?.name || 'Пользователь'}!
              </p>
            </div>
            <button
              onClick={logout}
              className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="h-5 w-5" />
              <span>Выйти</span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Создание комнаты */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
              <Plus className="h-5 w-5 mr-2" style={{ color: THEME_COLORS.primary }} />
              Создать встречу
            </h2>
            
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Название встречи"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="requirePassword"
                  checked={newRoomRequiresPassword}
                  onChange={(e) => setNewRoomRequiresPassword(e.target.checked)}
                  className="mr-2"
                />
                <label htmlFor="requirePassword" className="text-sm text-gray-700">
                  Требовать пароль
                </label>
              </div>
              
              {newRoomRequiresPassword && (
                <input
                  type="password"
                  placeholder="Пароль для комнаты"
                  value={newRoomPassword}
                  onChange={(e) => setNewRoomPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              )}
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="waitingRoom"
                  checked={newRoomHasWaitingRoom}
                  onChange={(e) => setNewRoomHasWaitingRoom(e.target.checked)}
                  className="mr-2"
                />
                <label htmlFor="waitingRoom" className="text-sm text-gray-700">
                  Включить зал ожидания
                </label>
              </div>
              
              <div>
                <label className="block text-sm text-gray-700 mb-1">
                  Максимум участников: {newRoomMaxParticipants}
                </label>
                <input
                  type="range"
                  min="2"
                  max="50"
                  value={newRoomMaxParticipants}
                  onChange={(e) => setNewRoomMaxParticipants(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
              
              <button
                onClick={createRoom}
                className="w-full px-4 py-3 text-white rounded-lg transition-colors font-medium flex items-center justify-center space-x-2"
                style={{ 
                  backgroundColor: THEME_COLORS.primary,
                  ':hover': { backgroundColor: THEME_COLORS.primaryHover }
                }}
                onMouseOver={(e) => e.target.style.backgroundColor = THEME_COLORS.primaryHover}
                onMouseOut={(e) => e.target.style.backgroundColor = THEME_COLORS.primary}
              >
                <Phone className="h-5 w-5" />
                <span>Создать встречу</span>
              </button>
            </div>
          </div>

          {/* Присоединение по коду */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
              <Link className="h-5 w-5 mr-2" style={{ color: THEME_COLORS.primary }} />
              Присоединиться к встрече
            </h2>
            
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Введите код встречи"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              
              <input
                type="password"
                placeholder="Пароль (если требуется)"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              
              <button
                onClick={joinRoomByCode}
                className="w-full px-4 py-3 text-white rounded-lg transition-colors font-medium flex items-center justify-center space-x-2"
                style={{ 
                  backgroundColor: THEME_COLORS.primary,
                  ':hover': { backgroundColor: THEME_COLORS.primaryHover }
                }}
                onMouseOver={(e) => e.target.style.backgroundColor = THEME_COLORS.primaryHover}
                onMouseOut={(e) => e.target.style.backgroundColor = THEME_COLORS.primary}
              >
                <Phone className="h-5 w-5" />
                <span>Присоединиться к встрече</span>
              </button>
            </div>
          </div>
        </div>

        {/* Мои комнаты */}
        {userRooms.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mt-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
              <User className="h-5 w-5 mr-2" style={{ color: THEME_COLORS.primary }} />
              Мои встречи
            </h2>
            
            <div className="space-y-3">
              {userRooms.map((room) => (
                <div key={room.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-medium text-gray-900">{room.name}</h3>
                      {room.role === 'creator' && (
                        <Crown className="h-4 w-4 text-yellow-500" />
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      Код: {room.id} • Создана: {formatDate(room.created_at)}
                    </p>
                    <p className="text-sm text-gray-500">
                      Участников: {room.participants_count || 0} / {room.max_participants}
                    </p>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => copyRoomCode(room.id)}
                      className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                      title="Копировать код"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    
                    <button
                      onClick={() => joinRoom(room.id)}
                      className="px-4 py-2 text-white rounded-lg transition-colors flex items-center space-x-2"
                      style={{ 
                        backgroundColor: THEME_COLORS.primary,
                        ':hover': { backgroundColor: THEME_COLORS.primaryHover }
                      }}
                      onMouseOver={(e) => e.target.style.backgroundColor = THEME_COLORS.primaryHover}
                      onMouseOut={(e) => e.target.style.backgroundColor = THEME_COLORS.primary}
                    >
                      <Phone className="h-4 w-4" />
                      <span>Присоединиться</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Доступные комнаты */}
        {rooms.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mt-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
              <Users className="h-5 w-5 mr-2" style={{ color: THEME_COLORS.primary }} />
              Доступные встречи
            </h2>
            
            <div className="space-y-3">
              {rooms.map((room) => (
                <div key={room.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-medium text-gray-900">{room.name}</h3>
                      {room.requires_password && (
                        <Lock className="h-4 w-4 text-gray-500" />
                      )}
                      {room.has_waiting_room && (
                        <AlertCircle className="h-4 w-4 text-orange-500" />
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      Код: {room.id} • Создатель: {room.creator_name}
                    </p>
                    <p className="text-sm text-gray-500">
                      Участников: {room.participants?.length || 0} / {room.max_participants}
                    </p>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => copyRoomCode(room.id)}
                      className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                      title="Копировать код"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    
                    <button
                      onClick={() => joinRoom(room.id)}
                      className="px-4 py-2 text-white rounded-lg transition-colors flex items-center space-x-2"
                      style={{ 
                        backgroundColor: THEME_COLORS.primary,
                        ':hover': { backgroundColor: THEME_COLORS.primaryHover }
                      }}
                      onMouseOver={(e) => e.target.style.backgroundColor = THEME_COLORS.primaryHover}
                      onMouseOut={(e) => e.target.style.backgroundColor = THEME_COLORS.primary}
                    >
                      <Phone className="h-4 w-4" />
                      <span>Присоединиться</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HomePage;
