import { useState, useEffect } from 'react';
import { X, Minimize2, Maximize2, Mail, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';

interface SyncProgress {
  type: 'progress' | 'connected' | 'complete';
  stage: string;
  progress: number;
  message: string;
  timestamp: string;
  details?: {
    totalAccounts?: number;
    completed?: number;
    total?: number;
    emailsProcessed?: number;
    suggestionsGenerated?: number;
    candidateEmails?: number;
    account?: string;
  };
}

/**
 * Fail only after the server has been silent this long. The server reports
 * progress at every stage, so a gap this size means it has genuinely stopped,
 * not that the mailbox is large.
 */
const STALL_TIMEOUT_MS = 3 * 60 * 1000;

/** Absolute ceiling, for a server that dies without closing the SSE stream. */
const MAX_SYNC_MS = 60 * 60 * 1000;

export function SyncProgressPanel() {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isClosed, setIsClosed] = useState(true);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [isError, setIsError] = useState(false);
  const [syncStartTime, setSyncStartTime] = useState<number | null>(null);
  const [lastProgressAt, setLastProgressAt] = useState<number>(() => Date.now());
  const [, setLocation] = useLocation();

  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
  });

  // Check for justOnboarded flag to auto-open panel on mount
  useEffect(() => {
    const justOnboarded = localStorage.getItem('justOnboarded');
    const onboardedAt = localStorage.getItem('onboardedAt');
    
    if (justOnboarded === 'true' && onboardedAt) {
      const timeSinceOnboarding = Date.now() - parseInt(onboardedAt);
      
      // Auto-open if flag set within last 5 minutes
      if (timeSinceOnboarding < 5 * 60 * 1000) {
        setIsClosed(false);
        setSyncProgress({
          type: 'progress',
          stage: 'initializing',
          progress: 0,
          message: 'Initializing email sync...',
          timestamp: new Date().toISOString(),
        });
        
        // Clear the flag after opening
        localStorage.removeItem('justOnboarded');
        localStorage.removeItem('onboardedAt');
      }
    }
  }, [user?.id]);

  // Listen for custom sync trigger events (opens panel instantly)
  useEffect(() => {
    const handleSyncTrigger = () => {
      // Reset state and open panel immediately when sync is triggered from any page
      setIsComplete(false);
      setIsError(false);
      setIsClosed(false);
      setSyncStartTime(Date.now()); // Track when sync started
      setLastProgressAt(Date.now()); // Reset the stall watchdog
      setSyncProgress({
        type: 'progress',
        stage: 'initializing',
        progress: 0,
        message: 'Initializing email sync...',
        timestamp: new Date().toISOString(),
      });
      
      // Set flag to indicate sync is in progress
      localStorage.setItem('syncInProgress', 'true');
    };
    
    window.addEventListener('syncTrigger', handleSyncTrigger);
    
    return () => {
      window.removeEventListener('syncTrigger', handleSyncTrigger);
    };
  }, []); // No dependencies - always listen

  // Clear sync flag when sync completes or errors
  useEffect(() => {
    if (isComplete || isError) {
      localStorage.removeItem('syncInProgress');
    }
  }, [isComplete, isError]);

  /**
   * Watchdog for stalled syncs.
   *
   * This previously failed the sync after 10 minutes of *total* duration, which
   * punished large mailboxes for being large -- a legitimate sync that took
   * longer was reported to the user as a timeout while the server was still
   * working. What actually indicates a problem is the server going quiet, so we
   * measure time since the last progress event instead, with a long absolute
   * backstop for the case where the server dies mid-stream without closing the
   * connection.
   */
  useEffect(() => {
    if (!syncStartTime || isComplete || isError) return;

    const fail = (message: string, reason: string) => {
      console.error(`Sync watchdog: ${reason}`);
      setIsError(true);
      setSyncProgress(prev => (prev ? { ...prev, stage: 'error', message } : null));
      setSyncStartTime(null);
    };

    const interval = setInterval(() => {
      const sinceProgress = Date.now() - lastProgressAt;
      const elapsed = Date.now() - syncStartTime;

      if (sinceProgress > STALL_TIMEOUT_MS) {
        fail(
          'Sync stopped responding. Please try again.',
          `no progress for ${Math.round(sinceProgress / 1000)}s`
        );
      } else if (elapsed > MAX_SYNC_MS) {
        fail(
          'Sync is taking unusually long. Please try again.',
          `exceeded ${MAX_SYNC_MS / 60000} minute backstop`
        );
      }
    }, 15000); // Check every 15 seconds

    return () => clearInterval(interval);
  }, [syncStartTime, isComplete, isError, lastProgressAt]);

  useEffect(() => {
    if (!user?.id) return;

    let eventSource: EventSource | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      // Clean up existing connection
      if (eventSource) {
        eventSource.close();
      }

      // Connect to SSE endpoint for real-time progress
      eventSource = new EventSource(`/api/sync-progress/${user.id}`);

      // Reset heartbeat on each message
      eventSource.onmessage = (event) => {
        // Clear and reset heartbeat timeout
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => {
          console.warn('SSE heartbeat timeout, reconnecting...');
          if (reconnectAttempts < maxReconnectAttempts) {
            eventSource?.close();
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
            reconnectTimeout = setTimeout(connect, delay);
          }
        }, 60000); // 60 second heartbeat timeout

        try {
          const data: SyncProgress = JSON.parse(event.data);
          
          if (data.type === 'connected') {
            console.log('SSE connected for sync progress');
            reconnectAttempts = 0; // Reset on successful connection
            return;
          }

          if (data.type === 'progress') {
            setSyncProgress(data);
            setIsClosed(false);
            setLastProgressAt(Date.now()); // Feeds the stall watchdog

            // Check if sync is complete
            if (data.stage === 'suggestions_ready' || data.progress >= 100) {
              setIsComplete(true);
            }
          }
        } catch (error) {
          console.error('Error parsing SSE data:', error);
        }
      };

      eventSource.onerror = () => {
        console.error('SSE connection error');
        
        // Clean up heartbeat
        if (heartbeatTimeout) {
          clearTimeout(heartbeatTimeout);
          heartbeatTimeout = null;
        }

        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
          
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connect, delay);
        } else {
          console.error('Max reconnection attempts reached - sync failed');
          // Set error state to clear sync flag and allow retry
          setIsError(true);
          setSyncProgress(prev => prev ? {
            ...prev,
            stage: 'error',
            message: 'Sync failed after multiple connection attempts. Please try again.',
          } : null);
        }
        
        eventSource?.close();
      };
    };

    // Initial connection
    connect();

    return () => {
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) eventSource.close();
    };
  }, [user?.id]);

  if (isClosed || !syncProgress) return null;

  return (
    <div 
      className="fixed bottom-6 right-6 z-50 w-96 animate-in slide-in-from-bottom-5"
      data-testid="sync-progress-panel"
    >
      <Card className="border-2 shadow-2xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              {isError ? (
                <AlertCircle className="h-5 w-5 text-red-500" data-testid="icon-error" />
              ) : isComplete ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" data-testid="icon-complete" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" data-testid="icon-syncing" />
              )}
              {isError ? 'Sync Failed' : isComplete ? 'Sync Complete!' : 'Syncing Emails'}
            </CardTitle>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsMinimized(!isMinimized)}
                data-testid="button-minimize"
              >
                {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsClosed(true)}
                data-testid="button-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        {!isMinimized && (
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{syncProgress.message}</span>
                <span className="font-medium">{Math.round(syncProgress.progress)}%</span>
              </div>
              <Progress value={syncProgress.progress} className="h-2" />
            </div>

            {syncProgress.details && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                {syncProgress.details.emailsProcessed !== undefined && (
                  <div className="flex items-center gap-2" data-testid="stat-emails-scanned">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{syncProgress.details.emailsProcessed}</div>
                      <div className="text-xs text-muted-foreground">Emails Scanned</div>
                    </div>
                  </div>
                )}
                
                {syncProgress.details.candidateEmails !== undefined && (
                  <div className="flex items-center gap-2" data-testid="stat-candidates-found">
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{syncProgress.details.candidateEmails}</div>
                      <div className="text-xs text-muted-foreground">Candidates Found</div>
                    </div>
                  </div>
                )}

                {syncProgress.details.suggestionsGenerated !== undefined && (
                  <div className="flex items-center gap-2 col-span-2" data-testid="stat-suggestions">
                    <div>
                      <div className="font-medium text-green-600">{syncProgress.details.suggestionsGenerated} Suggestions</div>
                      <div className="text-xs text-muted-foreground">Ready for review</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isComplete && syncProgress.details?.suggestionsGenerated && syncProgress.details.suggestionsGenerated > 0 && (
              <Button 
                className="w-full" 
                data-testid="button-review-suggestions"
                onClick={() => setLocation('/review')}
              >
                Review Suggestions
              </Button>
            )}

            {isComplete && (!syncProgress.details?.suggestionsGenerated || syncProgress.details.suggestionsGenerated === 0) && (
              <div className="text-sm text-center text-muted-foreground py-2">
                No subscription suggestions found
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
