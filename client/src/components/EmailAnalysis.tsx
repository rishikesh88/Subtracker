import { Mail } from "lucide-react";
import { type Email } from "@shared/schema";

interface EmailAnalysisProps {
  emails: Email[];
}

export function EmailAnalysis({ emails }: EmailAnalysisProps) {
  const getStatusBadgeClass = (processed: boolean) => {
    return processed
      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
      : "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200";
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="bg-card rounded-lg border border-border mt-6">
      <div className="p-6 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">Recent Email Analysis</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Latest transaction emails processed
        </p>
      </div>

      {emails.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-muted-foreground" data-testid="no-emails">
            No emails have been analyzed yet. Sync your Gmail to start analyzing emails.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {emails.slice(0, 10).map((email) => (
            <div
              key={email.id}
              className="p-4 hover:bg-accent/50 transition-colors"
              data-testid={`email-${email.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-950 rounded-full flex items-center justify-center">
                    <Mail className="text-blue-600 dark:text-blue-400 w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground" data-testid={`email-subject-${email.id}`}>
                      {email.subject}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid={`email-from-${email.id}`}>
                      {email.fromName || email.fromEmail}
                    </p>
                    {email.isTransaction && email.extractedAmount && (
                      <p className="text-xs text-primary" data-testid={`email-amount-${email.id}`}>
                        Amount: ${parseFloat(email.extractedAmount).toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${getStatusBadgeClass(email.processed || false)}`}
                    data-testid={`email-status-${email.id}`}
                  >
                    {email.processed ? "Processed" : "Pending"}
                  </span>
                  <p className="text-xs text-muted-foreground mt-1" data-testid={`email-date-${email.id}`}>
                    {formatDate(email.receivedAt)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
