import { Mail, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type Email } from "@shared/schema";

interface EmailAnalysisProps {
  emails: Email[];
}

export function EmailAnalysis({ emails }: EmailAnalysisProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const emailsPerPage = 10;
  const totalPages = Math.ceil(emails.length / emailsPerPage);
  const startIndex = (currentPage - 1) * emailsPerPage;
  const endIndex = startIndex + emailsPerPage;
  const currentEmails = emails.slice(startIndex, endIndex);

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

  // Calculate email statistics
  const transactionEmails = emails.filter(email => email.isTransaction);
  const processedEmails = emails.filter(email => email.processed);

  return (
    <div className="bg-card rounded-lg border border-border mt-6">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Email Analysis</h3>
            <p className="text-sm text-muted-foreground mt-1">
              All emails fetched from Gmail (past 90 days)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="flex items-center gap-1" data-testid="email-stats">
              <Info className="h-3 w-3" />
              {emails.length} total
            </Badge>
            <Badge variant="secondary" data-testid="transaction-count">
              {transactionEmails.length} transactions
            </Badge>
            <Badge variant="default" data-testid="processed-count">
              {processedEmails.length} processed
            </Badge>
          </div>
        </div>
      </div>

      {emails.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-muted-foreground" data-testid="no-emails">
            No emails have been analyzed yet. Sync your Gmail to start analyzing emails.
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-border">
            {currentEmails.map((email) => (
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
                          Amount: {email.extractedCurrency === 'INR' ? '₹' : '$'}{parseFloat(email.extractedAmount).toLocaleString()}
                        </p>
                      )}
                      {email.merchantName && (
                        <p className="text-xs text-blue-600 dark:text-blue-400" data-testid={`email-merchant-${email.id}`}>
                          Merchant: {email.merchantName}
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
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-border flex items-center justify-between">
              <div className="text-sm text-muted-foreground" data-testid="pagination-info">
                Showing {startIndex + 1}-{Math.min(endIndex, emails.length)} of {emails.length} emails
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  data-testid="prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-2" data-testid="page-indicator">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  data-testid="next-page"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}