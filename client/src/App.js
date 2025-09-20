import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import CookieSessionManager from './utils/CookieSessionManager';

// Импорт компонентов
import AuthPage from './components/AuthPage';
import HomePage from './components/HomePage';
import MeetingRoom from './components/MeetingRoom';
import AudioMeetingRoom from './components/AudioMeetingRoom';

const SecureVoiceApp = () => {
  // Основные состояния
  const [sessionManager] = useState(() => new CookieSessionManager());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Инициализация при загрузке
  useEffect(() => {
    const initializeApp = async () => {
      console.log('🚀 Инициализация приложения...');
      
      // Проверяем сохраненную сессию
      if (await sessionManager.hasValidSession()) {
        console.log('✅ Найдена действующая сессия');
        const userData = await sessionManager.getCurrentUser();
        console.log('👤 Данные пользователя:', userData);
        if (userData && (userData.id || userData.user_id)) {
          setCurrentUser(userData);
          setIsAuthenticated(true);
          console.log('✅ Пользователь авторизован:', userData.name);
        } else {
          console.log('⚠️ Неверные данные пользователя, сбрасываем сессию');
          sessionManager.clearSession();
          setIsAuthenticated(false);
          setCurrentUser(null);
        }
      } else {
        console.log('❌ Действующая сессия не найдена');
        setIsAuthenticated(false);
        setCurrentUser(null);
      }
      
      // Небольшая задержка для стабилизации
      setTimeout(() => {
        setIsInitialized(true);
      }, 100);
    };

    initializeApp();
  }, [sessionManager]);
    
    // Показываем загрузку пока не инициализированы
    if (!isInitialized) {
    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-white">Загрузка...</p>
          </div>
      </div>
    );
    }

    return (
    <Router>
      <div className="App">
        <Routes>
          {/* Главная страница - авторизация или дашборд */}
          <Route 
            path="/" 
            element={
              !isAuthenticated ? (
                <AuthPage 
                  sessionManager={sessionManager}
                  setIsAuthenticated={setIsAuthenticated}
                  setCurrentUser={setCurrentUser}
                />
              ) : (
                <HomePage 
                  sessionManager={sessionManager}
                  isAuthenticated={isAuthenticated}
                  currentUser={currentUser}
                  setCurrentUser={setCurrentUser}
                  setIsAuthenticated={setIsAuthenticated}
                />
              )
            } 
          />
          
          {/* Страница встречи - доступна всем */}
          <Route 
            path="/room/:roomId" 
            element={<MeetingRoom />} 
          />
          
          {/* Страница аудио-встречи - доступна всем */}
          <Route 
            path="/audio/:roomId" 
            element={<AudioMeetingRoom />} 
          />
          
          {/* Перенаправление неизвестных маршрутов */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
            </div>
    </Router>
  );
};

export default SecureVoiceApp;
