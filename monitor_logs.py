#!/usr/bin/env python3
"""
Скрипт для мониторинга логов сервера в реальном времени
"""
import time
import os
import sys

def monitor_logs():
    """Мониторинг логов в реальном времени"""
    log_file = "server/server.log"
    
    if not os.path.exists(log_file):
        print(f"❌ Файл логов {log_file} не найден!")
        return
    
    print("📊 Мониторинг логов сервера SecureVoice")
    print("=" * 50)
    print("Нажмите Ctrl+C для выхода")
    print()
    
    # Читаем существующие логи
    with open(log_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        for line in lines:
            print(line.strip())
    
    # Мониторим новые записи
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            # Переходим в конец файла
            f.seek(0, 2)
            
            while True:
                line = f.readline()
                if line:
                    print(line.strip())
                else:
                    time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n👋 Мониторинг остановлен")

if __name__ == "__main__":
    monitor_logs()
