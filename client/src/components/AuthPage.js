import React, { useState } from 'react';
import { User, Lock, LogIn } from 'lucide-react';

const THEME_COLORS = {
  primary: '#70BD1F',
  primaryHover: '#5fa318',
  primaryLight: '#70BD1F30'
};

const AuthPage = ({ sessionManager, setIsAuthenticated, setCurrentUser }) => {
  const [userName, setUserName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const API_BASE_URL = process.env.REACT_APP_API_URL || window.location.origin;

  const handleAuth = async () => {
    if (!userName.trim()) {
      alert('Введите ваше имя');
      return;
    }

    setIsLoading(true);

    try {
      const data = await sessionManager.createOrRestoreSession(userName, API_BASE_URL);
      console.log('✅ Аутентификация успешна:', data);
      setCurrentUser(data.user);
      setIsAuthenticated(true);

    } catch (error) {
      console.error('❌ Ошибка аутентификации:', error);
      alert('Ошибка входа: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleAuth();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Логотип и заголовок */}
        <div className="text-center mb-8">
          <div 
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: THEME_COLORS.primary }}
          >
            <Lock className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Secure Voice</h1>
          <p className="text-gray-600">Безопасные голосовые встречи</p>
        </div>

        {/* Форма входа */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 text-center">
            Добро пожаловать
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ваше имя
              </label>
              <div className="relative">
                <User className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Введите ваше имя"
                  className="w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  disabled={isLoading}
                />
              </div>
            </div>
            
            <button
              onClick={handleAuth}
              disabled={isLoading || !userName.trim()}
              className="w-full flex items-center justify-center px-4 py-3 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ 
                backgroundColor: THEME_COLORS.primary,
                ':hover': { backgroundColor: THEME_COLORS.primaryHover }
              }}
              onMouseOver={(e) => !e.target.disabled && (e.target.style.backgroundColor = THEME_COLORS.primaryHover)}
              onMouseOut={(e) => !e.target.disabled && (e.target.style.backgroundColor = THEME_COLORS.primary)}
            >
              {isLoading ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Вход...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <LogIn className="h-5 w-5" />
                  <span>Войти</span>
                </div>
              )}
            </button>
          </div>
          
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              Нажимая "Войти", вы принимаете условия использования
            </p>
          </div>
        </div>

        {/* Дополнительная информация */}
        <div className="mt-8 text-center">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <h3 className="font-medium text-gray-900 mb-2">
              🔒 Безопасность и приватность
            </h3>
            <p className="text-sm text-gray-600">
              Все звонки зашифрованы end-to-end. Мы не записываем и не сохраняем ваши разговоры.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
