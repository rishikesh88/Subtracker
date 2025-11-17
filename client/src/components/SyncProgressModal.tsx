import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSyncProgress, type SyncProgressUpdate } from "@/hooks/useSyncProgress";
import { Loader2, CheckCircle, AlertCircle, Wifi, WifiOff } from "lucide-react";

interface SyncProgressModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  onComplete?: () => void;
}

const stageLabels: Record<string, string> = {
  'starting': 'Initializing',
  'multi_account_sync_start': 'Starting Multi-Account Sync',
  'accounts_syncing': 'Syncing Email Accounts',
  'gmail_fetch': 'Fetching Emails',
  'parsing': 'Parsing Content',
  'parsing_complete': 'Processing Complete',
  'filtering_complete': 'Filtering Candidates', 
  'llm_analysis_start': 'Starting AI Analysis',
  'llm_analysis_complete': 'AI Analysis Complete',
  'sync_complete': 'Sync Complete'
};

const stageDescriptions: Record<string, string> = {
  'starting': 'Setting up sync process...',
  'multi_account_sync_start': 'Processing connected email accounts...',
  'accounts_syncing': 'Syncing email accounts in parallel...',
  'gmail_fetch': 'Retrieving emails from provider...',
  'parsing': 'Extracting content and metadata...',
  'parsing_complete': 'Email parsing finished',
  'filtering_complete': 'Selected candidate emails for analysis',
  'llm_analysis_start': 'Using AI to detect subscriptions...',
  'llm_analysis_complete': 'AI analysis finished successfully',
  'sync_complete': 'All done! Ready to review suggestions'
};

function formatUpdateTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString();
}

export function SyncProgressModal({ isOpen, onOpenChange, userId, onComplete }: SyncProgressModalProps) {
  const progress = useSyncProgress(userId, isOpen);

  const handleClose = () => {
    if (progress.progress === 100 && onComplete) {
      onComplete();
    }
    onOpenChange(false);
    progress.resetProgress();
  };

  const isComplete = progress.progress === 100;
  const isInProgress = progress.progress > 0 && progress.progress < 100;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]" data-testid="sync-progress-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isComplete ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : isInProgress ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            ) : (
              <div className="h-5 w-5" />
            )}
            Email Sync Progress
            {progress.isConnected ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-gray-400" />
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Progress */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <div className="font-medium" data-testid="current-stage">
                {stageLabels[progress.currentStage] || progress.currentStage}
              </div>
              <div className="text-sm text-muted-foreground" data-testid="progress-percentage">
                {progress.progress}%
              </div>
            </div>
            
            <Progress 
              value={progress.progress} 
              className="w-full" 
              data-testid="progress-bar"
            />
            
            <p className="text-sm text-muted-foreground" data-testid="progress-message">
              {stageDescriptions[progress.currentStage] || progress.message}
            </p>

            {progress.details && (
              <div className="flex gap-2 text-xs flex-wrap" data-testid="progress-details">
                {progress.details.totalAccounts !== undefined && progress.details.completed !== undefined && (
                  <Badge variant="secondary">{progress.details.completed}/{progress.details.totalAccounts} accounts</Badge>
                )}
                {progress.details.gmailAccounts !== undefined && (
                  <Badge variant="outline" className="bg-primary/10">{progress.details.gmailAccounts} Gmail</Badge>
                )}
                {progress.details.outlookAccounts !== undefined && (
                  <Badge variant="outline" className="bg-blue-100 dark:bg-blue-900">{progress.details.outlookAccounts} Outlook</Badge>
                )}
                {progress.details.emailCount && (
                  <Badge variant="secondary">{progress.details.emailCount} emails</Badge>
                )}
                {progress.details.candidates && (
                  <Badge variant="secondary">{progress.details.candidates} candidates</Badge>
                )}
                {progress.details.total && progress.details.parsed && (
                  <Badge variant="secondary">{progress.details.parsed}/{progress.details.total} parsed</Badge>
                )}
                {progress.details.high && (
                  <Badge variant="secondary">{progress.details.high} high confidence</Badge>
                )}
              </div>
            )}
          </div>

          {/* Error Display */}
          {progress.error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-md">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">{progress.error}</span>
            </div>
          )}

          {/* Update Log */}
          {progress.updates.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Progress Log</div>
              <ScrollArea className="h-32 rounded-md border p-3">
                <div className="space-y-1">
                  {progress.updates.slice(-10).map((update, index) => (
                    <div key={index} className="text-xs">
                      <span className="text-muted-foreground">
                        {formatUpdateTime(update.timestamp)}
                      </span>
                      <span className="ml-2">
                        {update.message || `Stage: ${update.stage}`}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-2">
            {isComplete ? (
              <Button 
                onClick={handleClose} 
                data-testid="button-view-suggestions"
              >
                View Suggestions
              </Button>
            ) : (
              <Button 
                variant="outline" 
                onClick={handleClose}
                data-testid="button-close-progress"
              >
                Run in Background
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}