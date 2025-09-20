/**
 * CookieSessionManager - надежное управление сессиями с использованием cookies и localStorage
 */

class CookieSessionManager {
  constructor() {
    this.SESSION_KEY = 'securevoice_session';
    this.COOKIE_NAME = 'securevoice_session';
    this.API_BASE_URL = process.env.REACT_APP_API_URL || window.location.origin;
  }

  /**
   * Установить cookie
   */
  setCookie(name, value, days = 30) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict;Secure=${window.location.protocol === 'https:'}`;
  }

  /**
   * Получить cookie
   */
  getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  /**
   * Удалить cookie
   */
  deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  }

  /**
   * Создать или восстановить сессию
   */
  async createOrRestoreSession(name) {
    try {
      console.log('🔄 Создание/восстановление сессии для:', name);
      
      // Проверяем существующую сессию
      const existingSession = await this.getStoredSession();
      if (existingSession && existingSession.user && existingSession.user.name === name) {
        console.log('✅ Восстановлена существующая сессия');
        return existingSession.user;
      }

      // Создаем новую сессию через API
      const response = await fetch(`${this.API_BASE_URL}/api/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          name: name.trim(),
          session_token: existingSession?.session_token || null
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Получены данные сессии:', data);

      // Сохраняем сессию в localStorage
      const sessionData = {
        session_token: data.session_token,
        jwt_token: data.jwt_token,
        user: data.user,
        saved_at: Date.now()
      };
      
      this.saveSession(sessionData);
      
      // Сохраняем session_token в cookie для надежности
      this.setCookie(this.COOKIE_NAME, data.session_token, 30);
      
      console.log('✅ Сессия сохранена в localStorage и cookie');
      return data.user;
      
    } catch (error) {
      console.error('❌ Ошибка создания сессии:', error);
      throw error;
    }
  }

  /**
   * Сохранить сессию в localStorage
   */
  saveSession(sessionData) {
    try {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
      console.log('💾 Сессия сохранена в localStorage');
    } catch (error) {
      console.error('❌ Ошибка сохранения сессии:', error);
    }
  }

  /**
   * Получить сохраненную сессию
   */
  async getStoredSession() {
    try {
      // Сначала проверяем localStorage
      const stored = localStorage.getItem(this.SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        
        // Проверяем, не истекла ли сессия (24 часа)
        const maxAge = 24 * 60 * 60 * 1000; // 24 часа в миллисекундах
        if (session.saved_at && (Date.now() - session.saved_at) < maxAge) {
          console.log('✅ Сессия найдена в localStorage');
          return session;
        } else {
          console.log('⚠️ Сессия в localStorage истекла');
          this.clearSession();
        }
      }

      // Если в localStorage нет, проверяем cookie
      const cookieToken = this.getCookie(this.COOKIE_NAME);
      if (cookieToken) {
        console.log('🍪 Найден session_token в cookie, пытаемся восстановить сессию');
        // Попытаемся восстановить сессию по токену из cookie
        try {
          const response = await fetch(`${this.API_BASE_URL}/api/session/restore`, {
            method: 'GET',
            credentials: 'include', // Важно для отправки cookies
          });
          
          if (response.ok) {
            const data = await response.json();
            console.log('✅ Сессия восстановлена по cookie:', data);
            
            // Сохраняем восстановленную сессию в localStorage
            const sessionData = {
              session_token: data.session_token,
              jwt_token: data.jwt_token,
              user: data.user,
              saved_at: Date.now()
            };
            this.saveSession(sessionData);
            
            return sessionData;
          } else {
            console.log('❌ Не удалось восстановить сессию по cookie');
            this.deleteCookie(this.COOKIE_NAME);
          }
        } catch (error) {
          console.error('❌ Ошибка восстановления сессии по cookie:', error);
          this.deleteCookie(this.COOKIE_NAME);
        }
      }

      console.log('❌ Сессия не найдена ни в localStorage, ни в cookie');
      return null;
    } catch (error) {
      console.error('❌ Ошибка получения сессии:', error);
      return null;
    }
  }

  /**
   * Получить текущего пользователя
   */
  async getCurrentUser() {
    const session = await this.getStoredSession();
    if (session && session.user) {
      console.log('👤 Пользователь найден:', session.user.name);
      return session.user;
    }
    console.log('❌ Пользователь не найден');
    return null;
  }

  /**
   * Проверить, есть ли действующая сессия
   */
  async hasValidSession() {
    const session = await this.getStoredSession();
    const isValid = !!(session && session.user && session.user.name);
    console.log('🔍 Проверка сессии:', { 
      hasSession: !!session, 
      hasUser: !!(session && session.user), 
      hasName: !!(session && session.user && session.user.name),
      isValid 
    });
    return isValid;
  }

  /**
   * Очистить сессию
   */
  clearSession() {
    try {
      localStorage.removeItem(this.SESSION_KEY);
      this.deleteCookie(this.COOKIE_NAME);
      console.log('🗑️ Сессия очищена из localStorage и cookie');
    } catch (error) {
      console.error('❌ Ошибка очистки сессии:', error);
    }
  }

  /**
   * Обновить JWT токен
   */
  async refreshJWTToken() {
    try {
      const session = await this.getStoredSession();
      if (!session || !session.session_token) {
        console.log('❌ Нет сессии для обновления JWT');
        return false;
      }

      console.log('🔄 Обновляем JWT токен...');
      const response = await fetch(`${this.API_BASE_URL}/api/session/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.session_token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.jwt_token) {
          // Обновляем JWT токен в сессии
          session.jwt_token = data.jwt_token;
          await this.saveSession(session);
          console.log('✅ JWT токен обновлен');
          return true;
        }
      }
      
      console.log('❌ Не удалось обновить JWT токен');
      return false;
    } catch (error) {
      console.error('❌ Ошибка обновления JWT токена:', error);
      return false;
    }
  }

  /**
   * Получить заголовки для API запросов
   */
  async getAuthHeaders() {
    const session = await this.getStoredSession();
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (session && session.jwt_token) {
      headers['Authorization'] = `Bearer ${session.jwt_token}`;
    } else if (session && session.session_token) {
      headers['Authorization'] = `Bearer ${session.session_token}`;
    }
    
    console.log('🔑 Заголовки аутентификации:', headers);
    return headers;
  }

  /**
   * Получить заголовки с автоматическим обновлением JWT токена
   */
  async getAuthHeadersWithRefresh() {
    let headers = await this.getAuthHeaders();
    
    // Если есть JWT токен, проверяем его валидность
    if (headers['Authorization'] && headers['Authorization'].startsWith('Bearer ')) {
      const token = headers['Authorization'].replace('Bearer ', '');
      
      // Простая проверка - если токен содержит точку, это JWT
      if (token.includes('.')) {
        try {
          // Декодируем JWT без проверки подписи для проверки времени истечения
          const payload = JSON.parse(atob(token.split('.')[1]));
          const now = Math.floor(Date.now() / 1000);
          
          // Если токен истекает в течение следующих 5 минут, обновляем его
          if (payload.exp && payload.exp - now < 300) {
            console.log('⚠️ JWT токен скоро истечет, обновляем...');
            const refreshed = await this.refreshJWTToken();
            if (refreshed) {
              headers = await this.getAuthHeaders();
            }
          }
        } catch (error) {
          console.log('⚠️ Не удалось проверить JWT токен, обновляем...');
          const refreshed = await this.refreshJWTToken();
          if (refreshed) {
            headers = await this.getAuthHeaders();
          }
        }
      }
    }
    
    return headers;
  }

  /**
   * Обновить время последнего визита
   */
  async updateLastSeen() {
    const session = await this.getStoredSession();
    if (session && session.user) {
      session.user.last_seen = Date.now() / 1000;
      this.saveSession(session);
    }
  }
}

export default CookieSessionManager;
