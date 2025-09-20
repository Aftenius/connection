class SessionManager {
  constructor() {
    this.SESSION_KEY = 'secure_voice_session';
    this.TOKEN_KEY = 'secure_voice_token';
  }

  // Создание или восстановление сессии
  async createOrRestoreSession(name) {
    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || window.location.origin;
      
      // Проверяем существующую сессию
      const existingSession = this.getCurrentUser();
      if (existingSession && existingSession.name === name) {
        console.log('✅ Восстановлена существующая сессия');
        return existingSession;
      }

      // Создаем новую сессию
      const response = await fetch(`${API_BASE_URL}/api/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Сохраняем сессию
      this.saveSession(data.user);
      this.saveToken(data.jwt_token);
      
      console.log('✅ Сессия создана/восстановлена:', data.user);
      return data.user;
    } catch (error) {
      console.error('❌ Ошибка создания сессии:', error);
      throw error;
    }
  }

  // Сохранение пользователя в localStorage
  saveSession(user) {
    try {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
    } catch (error) {
      console.error('❌ Ошибка сохранения сессии:', error);
    }
  }

  // Сохранение токена в localStorage
  saveToken(token) {
    try {
      localStorage.setItem(this.TOKEN_KEY, token);
    } catch (error) {
      console.error('❌ Ошибка сохранения токена:', error);
    }
  }

  // Получение текущего пользователя
  getCurrentUser() {
    try {
      const userData = localStorage.getItem(this.SESSION_KEY);
      console.log('🔍 getCurrentUser() - raw data:', userData);
      
      if (!userData) {
        console.log('🔍 getCurrentUser() - нет данных в localStorage');
        return null;
      }
      
      const user = JSON.parse(userData);
      console.log('🔍 getCurrentUser() - parsed user:', user);
      
      // Проверяем базовые поля пользователя (поддерживаем как user.id, так и user.user_id)
      if (user && typeof user === 'object' && (user.id || user.user_id) && user.name) {
        console.log('✅ getCurrentUser() - пользователь валиден');
        return user;
      }
      
      console.log('⚠️ Данные пользователя повреждены, очищаем сессию');
      this.clearSession();
      return null;
    } catch (error) {
      console.error('❌ Ошибка получения пользователя:', error);
      this.clearSession();
      return null;
    }
  }

  // Получение токена
  getToken() {
    try {
      return localStorage.getItem(this.TOKEN_KEY);
    } catch (error) {
      console.error('❌ Ошибка получения токена:', error);
      return null;
    }
  }

  // Проверка валидности сессии
  hasValidSession() {
    const session = this.getStoredSession();
    if (!session) return false;
    
    // Если есть сохраненная сессия, восстанавливаем данные
    this.sessionToken = session.session_token;
    this.jwtToken = session.jwt_token;
    this.userData = session.user;
    
    const user = this.getCurrentUser();
    // Проверяем как user.id, так и user.user_id (для совместимости с сервером)
    const isValid = !!(user && (user.id || user.user_id) && user.name);
    console.log('🔍 hasValidSession() проверка:', {
      user,
      hasId: !!(user && user.id),
      hasUserId: !!(user && user.user_id),
      hasName: !!(user && user.name),
      isValid
    });
    return isValid;
  }

  // Очистка сессии
  clearSession() {
    try {
      localStorage.removeItem(this.SESSION_KEY);
      localStorage.removeItem(this.TOKEN_KEY);
    } catch (error) {
      console.error('❌ Ошибка очистки сессии:', error);
    }
  }

  // Получение заголовков для API запросов
  getAuthHeaders() {
    const token = this.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }
}

export default SessionManager;
