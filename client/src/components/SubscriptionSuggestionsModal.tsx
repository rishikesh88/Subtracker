import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { SubscriptionSuggestion } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, AlertCircle, ChevronLeft, ChevronRight, ChevronDown, CheckSquare, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface SubscriptionSuggestionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubscriptionSuggestionsModal({ open, onOpenChange }: SubscriptionSuggestionsModalProps) {
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8; // Smaller page size for modal
  const [confidenceFilter, setConfidenceFilter] = useState<string>("");
  const [processingSuggestions, setProcessingSuggestions] = useState<string[]>([]);

  // Fetch suggestions with pagination
  const { data: suggestionsData = { suggestions: [], total: 0 }, isLoading, refetch } = useQuery<{
    suggestions: SubscriptionSuggestion[];
    total: number;
  }>({
    queryKey: [`/api/suggestions?userId=${userId}&page=${currentPage}&pageSize=${pageSize}&minConfidence=${confidenceFilter}`],
    enabled: !!userId && open, // Only fetch when modal is open
    refetchOnMount: true, // Always refetch fresh data when modal opens
    staleTime: 0, // Consider data stale immediately to ensure fresh fetches
  });
  
  // Force refetch when modal opens
  useEffect(() => {
    if (open && userId) {
      refetch();
    }
  }, [open, userId, refetch]);

  const { suggestions, total } = suggestionsData;
  const totalPages = Math.ceil(total / pageSize);

  // Reset selection and auto-select high confidence suggestions when page changes or modal opens
  useEffect(() => {
    if (!isLoading && suggestions.length > 0) {
      const highConfidenceIds = suggestions
        .filter(s => s.confidence === 'high')
        .map(s => s.id);
      setSelectedSuggestions(highConfidenceIds);
    } else if (!isLoading && suggestions.length === 0) {
      setSelectedSuggestions([]);
    }
  }, [currentPage, isLoading]); // Only depend on page changes and loading state

  // Approve suggestions mutation with optimistic updates
  const approveMutation = useMutation({
    mutationFn: async (suggestionIds: string[]) => {
      const response = await apiRequest("POST", "/api/suggestions/approve", {
        userId,
        suggestionIds,
      });
      return response.json();
    },
    onMutate: async (suggestionIds: string[]) => {
      // Optimistic update: immediately mark as processing
      setProcessingSuggestions(prev => [...prev, ...suggestionIds]);
      setSelectedSuggestions([]);
      
      toast({
        title: "Processing...",
        description: `Approving ${suggestionIds.length} suggestions`,
      });
      
      return { suggestionIds };
    },
    onSuccess: (data, variables) => {
      // Remove from processing state
      setProcessingSuggestions(prev => 
        prev.filter(id => !variables.includes(id))
      );
      
      toast({
        title: "Suggestions Approved",
        description: `Successfully approved ${data.approved} suggestions and created subscriptions`,
      });
      
      refetch();
      // Invalidate subscription queries to show new subscriptions
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${userId}`] });
    },
    onError: (error, variables, context) => {
      // Rollback optimistic update
      if (context?.suggestionIds) {
        setProcessingSuggestions(prev => 
          prev.filter(id => !context.suggestionIds.includes(id))
        );
        setSelectedSuggestions(context.suggestionIds);
      }
      
      toast({
        title: "Approval Failed",
        description: "Failed to approve suggestions. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Reject suggestions mutation with optimistic updates
  const rejectMutation = useMutation({
    mutationFn: async (suggestionIds: string[]) => {
      const response = await apiRequest("POST", "/api/suggestions/reject", {
        suggestionIds,
      });
      return response.json();
    },
    onMutate: async (suggestionIds: string[]) => {
      // Optimistic update: immediately mark as processing
      setProcessingSuggestions(prev => [...prev, ...suggestionIds]);
      setSelectedSuggestions([]);
      
      toast({
        title: "Processing...",
        description: `Skipping ${suggestionIds.length} suggestions`,
      });
      
      return { suggestionIds };
    },
    onSuccess: (data, variables) => {
      // Remove from processing state
      setProcessingSuggestions(prev => 
        prev.filter(id => !variables.includes(id))
      );
      
      toast({
        title: "Suggestions Skipped",
        description: `Successfully skipped ${data.rejected} suggestions`,
      });
      
      refetch();
    },
    onError: (error, variables, context) => {
      // Rollback optimistic update
      if (context?.suggestionIds) {
        setProcessingSuggestions(prev => 
          prev.filter(id => !context.suggestionIds.includes(id))
        );
        setSelectedSuggestions(context.suggestionIds);
      }
      
      toast({
        title: "Skip Failed", 
        description: "Failed to skip suggestions. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Clear all suggestions mutation
  const clearMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/suggestions/clear?userId=${userId}`);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Suggestions Cleared",
        description: `Successfully cleared ${data.cleared} suggestions`,
      });
      setSelectedSuggestions([]);
      refetch();
    },
    onError: () => {
      toast({
        title: "Clear Failed",
        description: "Failed to clear suggestions. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedSuggestions(suggestions.map(s => s.id));
    } else {
      setSelectedSuggestions([]);
    }
  };

  const handleSuggestionSelect = (suggestionId: string, checked: boolean) => {
    if (checked) {
      setSelectedSuggestions(prev => [...prev, suggestionId]);
    } else {
      setSelectedSuggestions(prev => prev.filter(id => id !== suggestionId));
    }
  };

  // Smart selection functions
  const selectHighConfidence = () => {
    const highConfidenceIds = suggestions
      .filter(s => s.confidence === 'high')
      .map(s => s.id);
    setSelectedSuggestions(highConfidenceIds);
  };

  const selectAboveAmount = () => {
    // Select suggestions with amount > $20 USD equivalent
    const threshold = 20;
    const aboveThresholdIds = suggestions
      .filter(s => {
        const amount = parseFloat(s.amount);
        // Convert to approximate USD for comparison
        const exchangeRates: Record<string, number> = { 
          'USD': 1, 'INR': 0.012, 'EUR': 1.09, 'GBP': 1.27 
        };
        const rate = exchangeRates[s.currency?.toUpperCase()] || 0.012; // Default INR
        const usdAmount = amount * rate;
        return usdAmount > threshold;
      })
      .map(s => s.id);
    setSelectedSuggestions(aboveThresholdIds);
  };

  const clearSelection = () => {
    setSelectedSuggestions([]);
  };

  const getConfidenceIcon = (confidence: string) => {
    switch (confidence) {
      case 'high': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'medium': return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case 'low': return <AlertCircle className="h-4 w-4 text-gray-600" />;
      default: return <AlertCircle className="h-4 w-4 text-gray-600" />;
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-200';
      case 'low': return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-950 dark:text-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-950 dark:text-gray-200';
    }
  };

  const formatCurrency = (amount: string, currency: string = "USD") => {
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

  // Skeleton card component for loading state
  const SkeletonCard = () => (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          <div className="flex justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="flex justify-between">
            <Skeleton className="h-3 w-18" />
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (!userId) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="suggestions-modal">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Review Subscription Suggestions</DialogTitle>
          <DialogDescription>
            Review and approve AI-generated subscription suggestions based on your email analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {/* Simplified header */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b">
            <div className="flex items-center gap-4">
              <Checkbox
                checked={selectedSuggestions.length === suggestions.length && suggestions.length > 0}
                onCheckedChange={handleSelectAll}
                data-testid="select-all-suggestions"
              />
              <span className="text-sm font-medium">
                {selectedSuggestions.length} of {suggestions.length} selected
              </span>
              {selectedSuggestions.length > 0 && suggestions.some(s => s.confidence === 'high' && selectedSuggestions.includes(s.id)) && (
                <Badge variant="outline" className="text-xs">
                  High confidence auto-selected
                </Badge>
              )}
            </div>
          </div>

          {/* Suggestions grid - Scrollable content */}
          <div className="flex-1 overflow-y-auto max-h-96">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Array.from({ length: pageSize }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            ) : suggestions.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No suggestions found</p>
                <p className="text-sm text-muted-foreground">Sync more emails to get subscription suggestions</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {suggestions.map((suggestion) => (
                  <Card 
                    key={suggestion.id} 
                    className={`hover:shadow-md transition-all duration-200 ${
                      selectedSuggestions.includes(suggestion.id) ? 'ring-2 ring-primary' : ''
                    } ${
                      processingSuggestions.includes(suggestion.id) ? 'opacity-60 scale-95 pointer-events-none' : ''
                    }`}
                    data-testid={`suggestion-card-${suggestion.id}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedSuggestions.includes(suggestion.id)}
                            onCheckedChange={(checked) => handleSuggestionSelect(suggestion.id, checked as boolean)}
                            disabled={processingSuggestions.includes(suggestion.id)}
                            data-testid={`suggestion-checkbox-${suggestion.id}`}
                          />
                          <div className="flex-1">
                            <CardTitle className="text-sm font-medium flex items-center gap-2" data-testid={`suggestion-name-${suggestion.id}`}>
                              {suggestion.serviceName}
                              {processingSuggestions.includes(suggestion.id) && (
                                <div className="animate-spin rounded-full h-3 w-3 border border-gray-300 border-t-primary"></div>
                              )}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {suggestion.merchantName || "Unknown merchant"}
                              {processingSuggestions.includes(suggestion.id) && (
                                <span className="ml-2 text-primary font-medium">Processing...</span>
                              )}
                            </CardDescription>
                          </div>
                        </div>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${getConfidenceColor(suggestion.confidence)}`}
                          data-testid={`suggestion-confidence-${suggestion.id}`}
                        >
                          {getConfidenceIcon(suggestion.confidence)}
                          {suggestion.confidence}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Amount:</span>
                          <span className="font-medium" data-testid={`suggestion-amount-${suggestion.id}`}>
                            {formatCurrency(suggestion.amount, suggestion.currency)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Frequency:</span>
                          <span className="capitalize" data-testid={`suggestion-frequency-${suggestion.id}`}>
                            {suggestion.frequency}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Category:</span>
                          <span className="capitalize" data-testid={`suggestion-category-${suggestion.id}`}>
                            {suggestion.category || "Other"}
                          </span>
                        </div>
                        
                        {/* Evidence Details - Expandable Section */}
                        <Collapsible className="mt-3 pt-3 border-t">
                          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
                            <ChevronDown className="h-3 w-3" />
                            <span>View Analysis Details</span>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-2 space-y-2">
                            {/* Validation Checks */}
                            {suggestion.validationChecks && (() => {
                              try {
                                const checks = typeof suggestion.validationChecks === 'string' 
                                  ? JSON.parse(suggestion.validationChecks)
                                  : suggestion.validationChecks;
                                return (
                                  <div className="text-xs space-y-1 bg-muted/30 p-2 rounded">
                                    <div className="font-medium mb-1">Validation Results:</div>
                                    <div className="flex items-center gap-1.5">
                                      {checks.subjectValid ? (
                                        <CheckCircle className="h-3 w-3 text-green-600" />
                                      ) : (
                                        <XCircle className="h-3 w-3 text-red-600" />
                                      )}
                                      <span className={checks.subjectValid ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                                        Subject Line
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {checks.contentValid ? (
                                        <CheckCircle className="h-3 w-3 text-green-600" />
                                      ) : (
                                        <XCircle className="h-3 w-3 text-red-600" />
                                      )}
                                      <span className={checks.contentValid ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                                        Email Content
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {checks.attachmentValid ? (
                                        <CheckCircle className="h-3 w-3 text-green-600" />
                                      ) : (
                                        <XCircle className="h-3 w-3 text-red-600" />
                                      )}
                                      <span className={checks.attachmentValid ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                                        Attachments
                                      </span>
                                    </div>
                                  </div>
                                );
                              } catch {
                                return null;
                              }
                            })()}
                            
                            {/* Recurring Keywords */}
                            {suggestion.recurringKeywords && suggestion.recurringKeywords.length > 0 && (
                              <div className="text-xs space-y-1 bg-muted/30 p-2 rounded">
                                <div className="font-medium mb-1 flex items-center gap-1">
                                  <CheckSquare className="h-3 w-3" />
                                  Recurring Patterns Found:
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {suggestion.recurringKeywords.map((keyword, idx) => (
                                    <Badge key={idx} variant="secondary" className="text-xs py-0 px-1.5">
                                      {keyword}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Attachment Evidence */}
                            {suggestion.attachmentEvidence && (
                              <div className="text-xs space-y-1 bg-muted/30 p-2 rounded">
                                <div className="font-medium mb-1 flex items-center gap-1">
                                  <FileText className="h-3 w-3" />
                                  Attachment Findings:
                                </div>
                                <p className="text-muted-foreground">{suggestion.attachmentEvidence}</p>
                              </div>
                            )}
                            
                            {/* Sender History */}
                            {suggestion.senderHistory && (
                              <div className="text-xs space-y-1 bg-muted/30 p-2 rounded">
                                <div className="font-medium mb-1">Email History Pattern:</div>
                                <p className="text-muted-foreground">{suggestion.senderHistory}</p>
                              </div>
                            )}
                            
                            {/* AI Reasoning */}
                            {suggestion.reasoning && (
                              <div className="text-xs space-y-1 bg-muted/30 p-2 rounded">
                                <div className="font-medium mb-1">AI Analysis:</div>
                                <p className="text-muted-foreground">{suggestion.reasoning}</p>
                              </div>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                        
                        {/* Quick Action Buttons */}
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={() => approveMutation.mutate([suggestion.id])}
                            disabled={processingSuggestions.includes(suggestion.id)}
                            data-testid={`quick-approve-${suggestion.id}`}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rejectMutation.mutate([suggestion.id])}
                            disabled={processingSuggestions.includes(suggestion.id)}
                            data-testid={`quick-skip-${suggestion.id}`}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Skip
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages} ({total} total)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  data-testid="prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  data-testid="next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Actions - Sticky footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending || suggestions.length === 0}
            className="text-destructive hover:text-destructive"
            data-testid="clear-all-suggestions"
          >
            <XCircle className="h-4 w-4 mr-2" />
            {clearMutation.isPending ? "Clearing..." : "Skip All"}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => rejectMutation.mutate(selectedSuggestions)}
              disabled={selectedSuggestions.length === 0 || rejectMutation.isPending}
              data-testid="reject-suggestions"
            >
              <XCircle className="h-4 w-4 mr-2" />
              {rejectMutation.isPending ? "Skipping..." : `Skip ${selectedSuggestions.length}`}
            </Button>
            <Button
              onClick={() => approveMutation.mutate(selectedSuggestions)}
              disabled={selectedSuggestions.length === 0 || approveMutation.isPending}
              data-testid="approve-suggestions"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {approveMutation.isPending ? "Approving..." : `Approve ${selectedSuggestions.length}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}