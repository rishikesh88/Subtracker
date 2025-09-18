import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface SyncProgressUpdate {
  type: 'progress' | 'connected' | 'error';
  timestamp: string;
  stage?: string;
  progress?: number;
  message?: string;
  details?: any;
}

export interface SyncProgressState {
  isConnected: boolean;
  currentStage: string;
  progress: number;
  message: string;
  details: any;
  updates: SyncProgressUpdate[];
  error: string | null;
}

export function useSyncProgress(userId: string | null, enabled: boolean = false) {
  const [progressState, setProgressState] = useState<SyncProgressState>({
    isConnected: false,
    currentStage: 'idle',
    progress: 0,
    message: 'Ready to sync',
    details: null,
    updates: [],
    error: null
  });

  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }

    // Create SSE connection
    const source = new EventSource(`/api/sync-progress/${userId}`);

    source.onopen = () => {
      console.log('SSE connection opened');
      setProgressState(prev => ({
        ...prev,
        isConnected: true,
        error: null
      }));
    };

    source.onmessage = (event) => {
      try {
        const update: SyncProgressUpdate = JSON.parse(event.data);
        
        setProgressState(prev => ({
          ...prev,
          updates: [...prev.updates, update],
          ...(update.type === 'progress' && {
            currentStage: update.stage || prev.currentStage,
            progress: update.progress || prev.progress,
            message: update.message || prev.message,
            details: update.details || prev.details
          })
        }));
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };

    source.onerror = (error) => {
      console.error('SSE connection error:', error);
      setProgressState(prev => ({
        ...prev,
        isConnected: false,
        error: 'Connection lost. Please refresh if sync doesn\'t resume.'
      }));
    };

    setEventSource(source);

    return () => {
      source.close();
      setEventSource(null);
      setProgressState(prev => ({
        ...prev,
        isConnected: false,
        currentStage: 'idle',
        progress: 0,
        message: 'Ready to sync',
        updates: []
      }));
    };
  }, [userId, enabled]);

  const resetProgress = () => {
    setProgressState(prev => ({
      ...prev,
      currentStage: 'idle',
      progress: 0,
      message: 'Ready to sync',
      details: null,
      updates: [],
      error: null
    }));
  };

  return {
    ...progressState,
    resetProgress
  };
}