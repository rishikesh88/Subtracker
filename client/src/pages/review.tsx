import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { SubscriptionSuggestion } from "@shared/schema";

interface EmailEvidence {
  id: string;
  subject: string;
  fromName: string;
  receivedAt: Date | string;
}

interface SuggestionWithEvidence extends SubscriptionSuggestion {
  emailEvidence?: EmailEvidence[];
}
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  ChevronLeft, 
  ChevronRight, 
  Mail, 
  FileText, 
  Calendar,
  Sparkles,
  ArrowLeft,
  Check,
  X
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";

export default function ReviewInbox() {
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [processingSuggestions, setProcessingSuggestions] = useState<string[]>([]);
  const [isSyncInProgress, setIsSyncInProgress] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ stage: '', progress: 0, message: '', suggestionsFound: 0 });

  const { data: suggestionsData = { suggestions: [], total: 0 }, isLoading, refetch } = useQuery<{
    suggestions: SuggestionWithEvidence[];
    total: number;
  }>({
    queryKey: [`/api/suggestions?userId=${userId}&page=${currentPage}&pageSize=${pageSize}`],
    enabled: !!userId,
    refetchOnMount: true,
    staleTime: 0,
  });

  // Listen for SSE events for progressive loading of suggestions
  useEffect(() => {
    if (!userId) return;
    
    const eventSource = new EventSource(`/api/sync-progress/${userId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle suggestion_found events - refresh suggestions list
        if (data.stage === 'suggestion_found') {
          setIsSyncInProgress(true);
          setSyncProgress({
            stage: data.stage,
            progress: data.progress || 0,
            message: data.message || '',
            suggestionsFound: data.details?.totalSuggestions || 0
          });
          // Refetch suggestions to show new ones
          refetch();
        } else if (data.stage === 'stage1_complete') {
          setIsSyncInProgress(true);
          setSyncProgress({
            stage: data.stage,
            progress: data.progress || 30,
            message: data.message || 'Analyzing subscriptions...',
            suggestionsFound: 0
          });
        } else if (data.stage === 'stage2_complete' || data.stage === 'suggestions_ready') {
          setSyncProgress({
            stage: data.stage,
            progress: 100,
            message: 'Analysis complete!',
            suggestionsFound: data.details?.totalSuggestions || syncProgress.suggestionsFound
          });
          // Final refetch and clear sync state after a short delay
          refetch();
          setTimeout(() => setIsSyncInProgress(false), 2000);
        } else if (data.stage === 'syncing' || data.stage === 'fetching' || data.stage === 'processing' || data.stage === 'analyzing') {
          setIsSyncInProgress(true);
          setSyncProgress({
            stage: data.stage,
            progress: data.progress || 0,
            message: data.message || 'Syncing...',
            suggestionsFound: 0
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    };
    
    eventSource.onerror = () => {
      // Connection lost - will auto-reconnect
    };
    
    return () => {
      eventSource.close();
    };
  }, [userId, refetch]);

  const { suggestions, total } = suggestionsData;
  const totalPages = Math.ceil(total / pageSize);

  useEffect(() => {
    if (!isLoading && suggestions.length > 0) {
      const highConfidenceIds = suggestions
        .filter(s => s.confidence === 'high')
        .map(s => s.id);
      setSelectedSuggestions(highConfidenceIds);
    }
  }, [suggestions, isLoading]);

  const approveMutation = useMutation({
    mutationFn: async (suggestionIds: string[]) => {
      const response = await apiRequest("POST", "/api/suggestions/approve", {
        userId,
        suggestionIds,
      });
      return response.json();
    },
    onMutate: async (suggestionIds: string[]) => {
      setProcessingSuggestions(prev => [...prev, ...suggestionIds]);
      setSelectedSuggestions(prev => prev.filter(id => !suggestionIds.includes(id)));
    },
    onSuccess: (data, variables) => {
      setProcessingSuggestions(prev => prev.filter(id => !variables.includes(id)));
      toast({
        title: "Subscription Approved",
        description: `Successfully approved ${data.approved} subscription${data.approved > 1 ? 's' : ''}`,
      });
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0]?.toString().startsWith('/api/suggestions') ?? false
      });
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0]?.toString().startsWith('/api/subscriptions') ?? false
      });
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0]?.toString().startsWith('/api/stats') ?? false
      });
    },
    onError: (error, variables) => {
      setProcessingSuggestions(prev => prev.filter(id => !variables.includes(id)));
      toast({
        title: "Approval Failed",
        description: "Failed to approve subscription. Please try again.",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (suggestionIds: string[]) => {
      const response = await apiRequest("POST", "/api/suggestions/reject", {
        suggestionIds,
      });
      return response.json();
    },
    onMutate: async (suggestionIds: string[]) => {
      setProcessingSuggestions(prev => [...prev, ...suggestionIds]);
      setSelectedSuggestions(prev => prev.filter(id => !suggestionIds.includes(id)));
    },
    onSuccess: (data, variables) => {
      setProcessingSuggestions(prev => prev.filter(id => !variables.includes(id)));
      toast({
        title: "Suggestion Rejected",
        description: `Skipped ${data.rejected} suggestion${data.rejected > 1 ? 's' : ''}`,
      });
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0]?.toString().startsWith('/api/suggestions') ?? false
      });
    },
    onError: (error, variables) => {
      setProcessingSuggestions(prev => prev.filter(id => !variables.includes(id)));
      toast({
        title: "Rejection Failed",
        description: "Failed to reject suggestion. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSuggestionSelect = (suggestionId: string, checked: boolean) => {
    if (checked) {
      setSelectedSuggestions(prev => [...prev, suggestionId]);
    } else {
      setSelectedSuggestions(prev => prev.filter(id => id !== suggestionId));
    }
  };

  const selectHighConfidence = () => {
    const highConfidenceIds = suggestions.filter(s => s.confidence === 'high').map(s => s.id);
    setSelectedSuggestions(highConfidenceIds);
  };

  const selectAll = () => {
    setSelectedSuggestions(suggestions.map(s => s.id));
  };

  const clearSelection = () => {
    setSelectedSuggestions([]);
  };

  const handleBatchApprove = () => {
    if (selectedSuggestions.length > 0) {
      approveMutation.mutate(selectedSuggestions);
    }
  };

  const handleBatchReject = () => {
    if (selectedSuggestions.length > 0) {
      rejectMutation.mutate(selectedSuggestions);
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'bg-green-100 text-green-800 border-green-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-gray-100 text-gray-600 border-gray-300';
      default: return 'bg-gray-100 text-gray-600 border-gray-300';
    }
  };

  const formatCurrency = (amount: string, currency: string = "INR") => {
    const num = parseFloat(amount);
    const validCurrency = currency && currency.length === 3 && currency !== "unknown" 
      ? currency.toUpperCase() 
      : "INR";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: validCurrency,
      }).format(num);
    } catch (error) {
      return `${validCurrency} ${num.toFixed(2)}`;
    }
  };

  const formatDetectedTime = (detectedAt: Date | string | null) => {
    if (!detectedAt) return "Unknown";
    const date = new Date(detectedAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Detected today";
    if (diffDays === 1) return "Detected yesterday";
    if (diffDays < 7) return `Detected ${diffDays} days ago`;
    if (diffDays < 30) return `Detected ${Math.floor(diffDays / 7)} weeks ago`;
    return `Detected ${Math.floor(diffDays / 30)} months ago`;
  };

  const getServiceInitial = (serviceName: string) => {
    return serviceName.charAt(0).toUpperCase();
  };

  const getServiceColor = (serviceName: string) => {
    return "bg-gray-100 text-gray-800 border border-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700";
  };

  const parseAttachmentEvidence = (evidence: string | null): { name: string; date: string }[] => {
    if (!evidence) return [];
    try {
      const parsed = JSON.parse(evidence);
      if (Array.isArray(parsed)) {
        return parsed.map(item => ({
          name: item.filename || item.name || 'Attachment',
          date: item.date || ''
        }));
      }
      return [];
    } catch {
      return [];
    }
  };

  if (!userId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please log in to view suggestions.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Progressive Loading Banner */}
      {isSyncInProgress && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 md:px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                {syncProgress.message || 'Analyzing your emails...'}
              </p>
              {syncProgress.suggestionsFound > 0 && (
                <p className="text-xs text-blue-600 dark:text-blue-300 mt-0.5">
                  {syncProgress.suggestionsFound} subscription{syncProgress.suggestionsFound !== 1 ? 's' : ''} found so far
                </p>
              )}
            </div>
            <div className="hidden sm:block">
              <div className="w-32 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${syncProgress.progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-card border-b border-border px-4 md:px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setLocation('/dashboard')}
              className="md:hidden"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-bold">Review Inbox</h1>
                {total > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {total} New
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Review and approve subscriptions detected from your connected accounts.
              </p>
            </div>
          </div>
          
          {/* AI Confidence Indicator */}
          <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="w-4 h-4 text-yellow-500" />
            <span>AI Confidence: High</span>
          </div>
        </div>

        {/* Batch Actions */}
        {suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 mr-4">
              <span className="text-sm text-muted-foreground">
                {selectedSuggestions.length} of {suggestions.length} selected
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={selectHighConfidence}>
              Select High Confidence
            </Button>
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={clearSelection}>
              Clear
            </Button>
            {selectedSuggestions.length > 0 && (
              <>
                <div className="w-px h-6 bg-border mx-2" />
                <Button 
                  size="sm" 
                  onClick={handleBatchApprove}
                  disabled={approveMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Check className="w-4 h-4 mr-1" />
                  Approve ({selectedSuggestions.length})
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleBatchReject}
                  disabled={rejectMutation.isPending}
                >
                  <X className="w-4 h-4 mr-1" />
                  Reject ({selectedSuggestions.length})
                </Button>
              </>
            )}
          </div>
        )}
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-6">
                <div className="flex items-start gap-4">
                  <Skeleton className="w-12 h-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              </Card>
            ))}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Mail className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No Suggestions</h3>
            <p className="text-muted-foreground text-center max-w-md">
              No subscription suggestions found. Sync your emails to detect new subscriptions.
            </p>
            <Button 
              className="mt-4" 
              onClick={() => setLocation('/dashboard')}
            >
              Go to Dashboard
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {suggestions.map((suggestion) => {
              const isProcessing = processingSuggestions.includes(suggestion.id);
              const isSelected = selectedSuggestions.includes(suggestion.id);
              const attachments = parseAttachmentEvidence(suggestion.attachmentEvidence);
              const confidencePercent = suggestion.confidenceScore 
                ? Math.round(parseFloat(suggestion.confidenceScore) * 100) 
                : null;

              return (
                <Card 
                  key={suggestion.id}
                  className={`transition-all duration-200 ${
                    isProcessing ? 'opacity-50 scale-[0.99]' : ''
                  } ${isSelected ? 'ring-2 ring-primary' : ''}`}
                  data-testid={`suggestion-card-${suggestion.id}`}
                >
                  <CardContent className="p-4 md:p-6">
                    {/* Top Row: Service Info + Actions */}
                    <div className="flex items-start gap-4">
                      {/* Checkbox */}
                      <div className="pt-1">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSuggestionSelect(suggestion.id, checked as boolean)}
                          disabled={isProcessing}
                          className="rounded-sm"
                        />
                      </div>

                      {/* Service Avatar */}
                      <div className={`w-12 h-12 rounded-lg ${getServiceColor(suggestion.serviceName)} flex items-center justify-center text-foreground font-bold text-xl flex-shrink-0 font-sans`}>
                        {getServiceInitial(suggestion.serviceName)}
                      </div>

                      {/* Service Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-lg">{suggestion.serviceName}</h3>
                          <Badge 
                            variant="outline" 
                            className={`text-xs capitalize ${getConfidenceColor(suggestion.confidence)}`}
                          >
                            {confidencePercent && `${confidencePercent}% `}{suggestion.confidence}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground mt-1">
                          <span className="capitalize">{suggestion.frequency}</span>
                          <span>•</span>
                          <span>{formatDetectedTime(suggestion.detectedAt)}</span>
                          {(suggestion.occurrences || 1) > 1 && (
                            <>
                              <span>•</span>
                              <span>{suggestion.occurrences} emails</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Individual Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => rejectMutation.mutate([suggestion.id])}
                          disabled={isProcessing}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => approveMutation.mutate([suggestion.id])}
                          disabled={isProcessing}
                          className="bg-[#16a349] hover:bg-gray-800 text-white"
                        >
                          <Check className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                      </div>
                    </div>

                    {/* Pricing Section */}
                    <div className="mt-4 border border-border rounded-lg bg-muted/30 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground font-medium">Subscription Price</span>
                        <span className="text-xl font-bold text-foreground">
                          {formatCurrency(suggestion.amount, suggestion.currency)}
                          <span className="text-sm font-normal text-muted-foreground ml-1">/ {suggestion.frequency}</span>
                        </span>
                      </div>
                    </div>

                    {/* Evidence Sections */}
                    <div className="mt-4 grid md:grid-cols-2 gap-4">
                      {/* Left Column */}
                      <div className="space-y-3">
                        {/* Email Detected Container */}
                        <div className="border border-border rounded-lg bg-muted/20 p-3">
                          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5" />
                            Email Detected
                          </p>
                          <div className="space-y-2">
                            {suggestion.emailEvidence && suggestion.emailEvidence.length > 0 ? (
                              <>
                                {/* Show only the latest email */}
                                <div className="text-sm">
                                  <p className="truncate text-foreground font-medium italic">"{suggestion.emailEvidence[0].subject}"</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <p className="text-xs text-muted-foreground">
                                      Received on {(() => {
                                        const d = new Date(suggestion.emailEvidence[0].receivedAt);
                                        const day = d.getDate();
                                        const suffix = ["th", "st", "nd", "rd"][(day % 10 > 3 || Math.floor(day / 10) === 1) ? 0 : day % 10];
                                        return `${day}${suffix} ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
                                      })()}
                                    </p>
                                    {suggestion.emailEvidence.length > 1 && (
                                      <Badge variant="secondary" className="text-xs">
                                        +{suggestion.emailEvidence.length - 1} email{suggestion.emailEvidence.length - 1 > 1 ? 's' : ''}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="text-sm">
                                <p className="truncate text-foreground font-medium italic">
                                  "{(() => {
                                    if (!suggestion.reasoning) return `Subscription detected from ${suggestion.serviceName}`;
                                    const match = suggestion.reasoning.match(/'([^']+)'/);
                                    return match ? match[1] : suggestion.reasoning.split('.')[0];
                                  })()}"
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Attachment Evidence */}
                        {attachments.length > 0 && (
                          <div className="border border-border rounded-lg bg-muted/20 p-3">
                            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5" />
                              Documents
                            </p>
                            <div className="space-y-1">
                              {attachments.map((att, idx) => (
                                <p key={idx} className="text-sm truncate">{att.name}</p>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Keywords Container */}
                        {suggestion.recurringKeywords && suggestion.recurringKeywords.length > 0 && (
                          <div className="border border-border rounded-lg bg-muted/20 p-3">
                            <p className="text-xs font-medium text-muted-foreground mb-2">Keywords Detected</p>
                            <div className="flex flex-wrap gap-1.5">
                              {suggestion.recurringKeywords.slice(0, 5).map((keyword, idx) => (
                                <Badge key={idx} variant="secondary" className="text-xs">
                                  {keyword}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Next Expected Date Container */}
                        {suggestion.nextBillingDate && (
                          <div className="border border-border rounded-lg bg-muted/30 p-3">
                            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5" />
                              Next Expected Payment
                            </p>
                            <p className="text-lg font-semibold text-foreground">
                              {new Date(suggestion.nextBillingDate).toLocaleDateString('en-US', { 
                                weekday: 'short',
                                month: 'long', 
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Right Column - AI Reasoning */}
                      <div>
                        <div className="border border-border rounded-lg bg-muted/20 p-4 h-full">
                          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5" />
                            AI Reasoning
                          </p>
                          <p className="text-sm text-foreground leading-relaxed">
                            {suggestion.reasoning || `This appears to be a ${suggestion.frequency} subscription to ${suggestion.serviceName} based on the email patterns detected.`}
                          </p>
                          {suggestion.category && (
                            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                              Category: <span className="capitalize font-medium">{suggestion.category}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground px-4">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
