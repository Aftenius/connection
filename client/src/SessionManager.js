/**
 * SessionManager - управление пользовательскими сессиями
 */

class SessionManager {
    constructor() {
        this.storageKey = 'securevoice_session';
        this.sessionToken = null;
        this.userData = null;
    }

    /**
     * Создать или восстановить сессию
     */
    async createOrRestoreSession(name, apiBaseUrl) {
        // Пытаемся восстановить существующую сессию
        const existingSession = this.getStoredSession();
        
        const requestData = {
            name: name.trim(),
            session_token: existingSession?.session_token
        };

        try {
            const response = await fetch(`${apiBaseUrl}/api/session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            // Сохраняем сессию
            this.sessionToken = data.session_token;
            this.userData = data.user;
            
            this.saveSession({
                session_token: data.session_token,
                user: data.user,
                saved_at: Date.now()
            });

            console.log('Сессия создана/восстановлена:', this.userData);
            return data;
            
        } catch (error) {
            console.error('Ошибка создания сессии:', error);
            throw error;
        }
    }

    /**
     * Сохранить сессию в localStorage
     */
    saveSession(sessionData) {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(sessionData));
        } catch (error) {
            console.error('Ошибка сохранения сессии:', error);
        }
    }

    /**
     * Получить сохраненную сессию
     */
    getStoredSession() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const session = JSON.parse(stored);
                
                // Проверяем, не истекла ли сессия (24 часа)
                const maxAge = 24 * 60 * 60 * 1000; // 24 часа в миллисекундах
                if (session.saved_at && (Date.now() - session.saved_at) < maxAge) {
                    return session;
                } else {
                    // Удаляем истекшую сессию
                    this.clearSession();
                }
            }
        } catch (error) {
            console.error('Ошибка получения сессии:', error);
        }
        return null;
    }

    /**
     * Очистить сессию
     */
    clearSession() {
        try {
            localStorage.removeItem(this.storageKey);
            this.sessionToken = null;
            this.userData = null;
        } catch (error) {
            console.error('Ошибка очистки сессии:', error);
        }
    }

    /**
     * Получить заголовки для API запросов
     */
    getAuthHeaders() {
        if (this.sessionToken) {
            return {
                'Authorization': `Bearer ${this.sessionToken}`,
                'Content-Type': 'application/json'
            };
        }
        return {
            'Content-Type': 'application/json'
        };
    }

    /**
     * Проверить, авторизован ли пользователь
     */
    isAuthenticated() {
        return !!this.sessionToken && !!this.userData;
    }

    /**
     * Получить данные пользователя
     */
    getUserData() {
        return this.userData;
    }

    /**
     * Получить токен сессии
     */
    getSessionToken() {
        return this.sessionToken;
    }

    /**
     * Обновить имя пользователя
     */
    updateUserName(newName) {
        if (this.userData) {
            this.userData.name = newName;
            // Обновляем сохраненную сессию
            const stored = this.getStoredSession();
            if (stored) {
                stored.user.name = newName;
                this.saveSession(stored);
            }
        }
    }

    /**
     * Получить сохраненное имя пользователя
     */
    getSavedUserName() {
        const session = this.getStoredSession();
        return session?.user?.name || '';
    }

    /**
     * Проверить, есть ли сохраненная сессия
     */
    hasSavedSession() {
        return !!this.getStoredSession();
    }

    /**
     * Получить метаинформацию о сессии
     */
    getSessionInfo() {
        const session = this.getStoredSession();
        if (session) {
            return {
                saved_at: session.saved_at,
                user_id: session.user?.user_id,
                name: session.user?.name,
                ip_address: session.user?.ip_address,
                created_at: session.user?.created_at,
                last_seen: session.user?.last_seen
            };
        }
        return null;
    }

    /**
     * Обновить время последнего визита
     */
    updateLastSeen() {
        if (this.userData) {
            this.userData.last_seen = Date.now() / 1000;
            const stored = this.getStoredSession();
            if (stored) {
                stored.user.last_seen = this.userData.last_seen;
                this.saveSession(stored);
            }
        }
    }
}

export default SessionManager;
