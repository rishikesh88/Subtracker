import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  'sync_complete': 'Sync Complete',
  'error': 'Sync Failed'
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

  // The server reports a run where every account failed as stage 'error' at
  // 99%, deliberately short of 100 so nothing here reads it as success.
  const isFailed = progress.currentStage === 'error';
  const isComplete = !isFailed && progress.progress === 100;
  const isInProgress = !isFailed && progress.progress > 0 && progress.progress < 100;
  const pct = Math.min(100, Math.max(0, progress.progress));

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]" data-testid="sync-progress-modal">
        <DialogHeader>
          <DialogTitle className="font-serif text-[21px] font-normal tracking-[-0.02em] leading-none flex flex-wrap items-center gap-2">
            {isFailed ? (
              <AlertCircle size={17} strokeWidth={2} className="text-destructive flex-none" />
            ) : isComplete ? (
              <CheckCircle size={17} strokeWidth={2} className="text-success flex-none" />
            ) : isInProgress ? (
              <Loader2 size={17} strokeWidth={2} className="animate-spin text-accent flex-none" />
            ) : (
              <div className="h-[17px] w-[17px] flex-none" />
            )}
            <span>Email sync progress</span>
            {progress.isConnected ? (
              <Wifi size={15} strokeWidth={2} className="text-success flex-none" />
            ) : (
              <WifiOff size={15} strokeWidth={2} className="text-muted-foreground flex-none" />
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Current Progress */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center gap-2">
              <div className="t-body font-semibold text-ink" data-testid="current-stage">
                {stageLabels[progress.currentStage] || progress.currentStage}
              </div>
              <div className="t-caption tabular flex-none" data-testid="progress-percentage">
                {pct}%
              </div>
            </div>

            <div className="h-1.5 rounded-full bg-line-soft overflow-hidden" data-testid="progress-bar">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>

            <p
              className={isFailed ? "t-caption text-destructive" : "t-caption"}
              data-testid="progress-message"
            >
              {isFailed
                ? progress.message
                : stageDescriptions[progress.currentStage] || progress.message}
            </p>

            {progress.details && (
              <div className="flex gap-2 flex-wrap" data-testid="progress-details">
                {progress.details.totalAccounts !== undefined && progress.details.completed !== undefined && (
                  <span className="badge-cadence">{progress.details.completed}/{progress.details.totalAccounts} accounts</span>
                )}
                {progress.details.gmailAccounts !== undefined && (
                  <span className="badge-cadence">{progress.details.gmailAccounts} Gmail</span>
                )}
                {progress.details.outlookAccounts !== undefined && (
                  <span className="badge-cadence">{progress.details.outlookAccounts} Outlook</span>
                )}
                {progress.details.emailCount && (
                  <span className="badge-cadence">{progress.details.emailCount} emails</span>
                )}
                {progress.details.candidates && (
                  <span className="badge-cadence">{progress.details.candidates} candidates</span>
                )}
                {progress.details.total && progress.details.parsed && (
                  <span className="badge-cadence">{progress.details.parsed}/{progress.details.total} parsed</span>
                )}
                {progress.details.high && (
                  <span className="badge-cadence">{progress.details.high} high confidence</span>
                )}
              </div>
            )}
          </div>

          {/* Error Display */}
          {progress.error && (
            <div className="flex items-center gap-2 bg-destructive/10 rounded-lg" style={{ padding: "10px 12px" }}>
              <AlertCircle size={15} strokeWidth={2} className="text-destructive flex-none" />
              <span className="t-body text-destructive">{progress.error}</span>
            </div>
          )}

          {/* Update Log */}
          {progress.updates.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="t-label">Progress log</div>
              <ScrollArea className="h-32 rounded-lg border border-line-soft" style={{ padding: "10px 12px" }}>
                <div className="flex flex-col gap-1">
                  {progress.updates.slice(-10).map((update, index) => (
                    <div key={index} className="t-caption">
                      <span className="text-muted-foreground">
                        {formatUpdateTime(update.timestamp)}
                      </span>
                      <span className="ml-2 text-ink">
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
              <button
                type="button"
                onClick={handleClose}
                className="btn-base btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="button-view-suggestions"
              >
                View suggestions
              </button>
            ) : (
              <button
                type="button"
                onClick={handleClose}
                className="btn-base btn-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="button-close-progress"
              >
                Run in background
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
