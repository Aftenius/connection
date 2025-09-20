import React, { useState, useEffect } from 'react';
import { User, Check, X, Clock, AlertCircle } from 'lucide-react';

const JoinRequestPopup = ({ 
    requests = [], 
    onApprove, 
    onReject, 
    onClose,
    isVisible 
}) => {
    const [processingRequests, setProcessingRequests] = useState(new Set());

    useEffect(() => {
        // Автоматически показываем попап при новых запросах
        if (requests.length > 0 && !isVisible) {
            // Здесь можно добавить звуковое уведомление
            console.log('🔔 Новый запрос на подключение!');
        }
    }, [requests, isVisible]);

    const handleApprove = async (userId) => {
        setProcessingRequests(prev => new Set(prev).add(userId));
        try {
            await onApprove(userId);
        } catch (error) {
            console.error('Ошибка одобрения:', error);
        } finally {
            setProcessingRequests(prev => {
                const newSet = new Set(prev);
                newSet.delete(userId);
                return newSet;
            });
        }
    };

    const handleReject = async (userId) => {
        setProcessingRequests(prev => new Set(prev).add(userId));
        try {
            await onReject(userId);
        } catch (error) {
            console.error('Ошибка отклонения:', error);
        } finally {
            setProcessingRequests(prev => {
                const newSet = new Set(prev);
                newSet.delete(userId);
                return newSet;
            });
        }
    };

    const formatTime = (timestamp) => {
        const date = new Date(timestamp * 1000);
        return date.toLocaleTimeString('ru-RU', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    };

    if (!isVisible || requests.length === 0) {
        return null;
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-xl shadow-2xl max-w-md w-full max-h-96 overflow-hidden">
                {/* Header */}
                <div className="bg-blue-600 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <AlertCircle size={20} className="text-white" />
                        <h3 className="text-white font-semibold">
                            Запросы на подключение ({requests.length})
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-white hover:text-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Requests List */}
                <div className="max-h-80 overflow-y-auto">
                    {requests.map((request) => {
                        const isProcessing = processingRequests.has(request.user.id);
                        
                        return (
                            <div 
                                key={request.user.id} 
                                className="border-b border-gray-700 last:border-b-0 p-4 hover:bg-gray-750 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    {/* User Info */}
                                    <div className="flex items-center space-x-3 flex-1">
                                        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                                            <User size={20} className="text-white" />
                                        </div>
                                        <div className="flex-1">
                                            <h4 className="text-white font-medium">
                                                {request.user.name}
                                            </h4>
                                            <div className="flex items-center space-x-2 text-sm text-gray-400">
                                                <Clock size={12} />
                                                <span>
                                                    Запрос в {formatTime(request.requested_at)}
                                                </span>
                                            </div>
                                            {request.user.ip_address && (
                                                <div className="text-xs text-gray-500">
                                                    IP: {request.user.ip_address}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center space-x-2">
                                        <button
                                            onClick={() => handleApprove(request.user.id)}
                                            disabled={isProcessing}
                                            className="p-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                                            title="Одобрить"
                                        >
                                            <Check size={16} className="text-white" />
                                        </button>
                                        <button
                                            onClick={() => handleReject(request.user.id)}
                                            disabled={isProcessing}
                                            className="p-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                                            title="Отклонить"
                                        >
                                            <X size={16} className="text-white" />
                                        </button>
                                    </div>
                                </div>

                                {isProcessing && (
                                    <div className="mt-2 text-sm text-blue-400">
                                        Обработка запроса...
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="bg-gray-700 px-6 py-3 text-center">
                    <p className="text-sm text-gray-400">
                        Новые участники ожидают вашего решения
                    </p>
                </div>
            </div>
        </div>
    );
};

export default JoinRequestPopup;
