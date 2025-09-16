import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { SubscriptionSuggestion } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Sidebar } from "@/components/Sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, AlertCircle, Eye, Calendar, Mail, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

export function SuggestionsPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [confidenceFilter, setConfidenceFilter] = useState<string>("");

  // Fetch suggestions with pagination
  const { data: suggestionsData = { suggestions: [], total: 0 }, isLoading, refetch } = useQuery<{
    suggestions: SubscriptionSuggestion[];
    total: number;
  }>({
    queryKey: [`/api/suggestions?userId=${userId}&page=${currentPage}&pageSize=${pageSize}&minConfidence=${confidenceFilter}`],
    enabled: !!userId,
  });

  if (!userId) {
    return <div className="p-8">Loading user...</div>;
  }

  const { suggestions, total } = suggestionsData;
  const totalPages = Math.ceil(total / pageSize);

  // Approve suggestions mutation
  const approveMutation = useMutation({
    mutationFn: async (suggestionIds: string[]) => {
      const response = await apiRequest("POST", "/api/suggestions/approve", {
        userId,
        suggestionIds,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Suggestions Approved",
        description: `Successfully approved ${data.approved} suggestions and created subscriptions`,
      });
      setSelectedSuggestions([]);
      refetch();
      // Invalidate subscription queries to show new subscriptions
      queryClient.invalidateQueries({ queryKey: [`/api/subscriptions`] });
    },
    onError: () => {
      toast({
        title: "Approval Failed",
        description: "Failed to approve suggestions. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Reject suggestions mutation
  const rejectMutation = useMutation({
    mutationFn: async (suggestionIds: string[]) => {
      const response = await apiRequest("POST", "/api/suggestions/reject", {
        suggestionIds,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Suggestions Rejected",
        description: `Rejected ${data.rejected} suggestions`,
      });
      setSelectedSuggestions([]);
      refetch();
    },
    onError: () => {
      toast({
        title: "Rejection Failed",
        description: "Failed to reject suggestions. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Clear all suggestions mutation
  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/suggestions/clear/${userId}`);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "All Suggestions Cleared",
        description: `Cleared ${data.cleared} suggestions`,
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

  const handleSelectSuggestion = (suggestionId: string, checked: boolean) => {
    if (checked) {
      setSelectedSuggestions(prev => [...prev, suggestionId]);
    } else {
      setSelectedSuggestions(prev => prev.filter(id => id !== suggestionId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedSuggestions(suggestions.map(s => s.id));
    } else {
      setSelectedSuggestions([]);
    }
  };

  const handleApproveSelected = () => {
    if (selectedSuggestions.length > 0) {
      approveMutation.mutate(selectedSuggestions);
    }
  };

  const handleRejectSelected = () => {
    if (selectedSuggestions.length > 0) {
      rejectMutation.mutate(selectedSuggestions);
    }
  };

  const getConfidenceBadge = (confidence: string, score: string) => {
    const percentScore = Math.round(parseFloat(score)); // Already 0-100 unified score
    
    switch (confidence) {
      case 'high':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" data-testid={`confidence-high`}>{confidence.toUpperCase()} ({percentScore}%)</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100" data-testid={`confidence-medium`}>{confidence.toUpperCase()} ({percentScore}%)</Badge>;
      case 'low':
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100" data-testid={`confidence-low`}>{confidence.toUpperCase()} ({percentScore}%)</Badge>;
      default:
        return <Badge variant="outline" data-testid={`confidence-unknown`}>{confidence}</Badge>;
    }
  };

  const formatCurrency = (amount: string, currency: string) => {
    const numAmount = parseFloat(amount);
    return currency === 'INR' ? `₹${numAmount.toFixed(2)}` : `${currency} ${numAmount.toFixed(2)}`;
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading subscription suggestions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar user={{ id: userId, username: "demo@example.com", gmailConnected: true }} isGmailConnected={true} />
      
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Subscription Suggestions</h2>
              <p className="text-sm text-muted-foreground">
                Review AI-detected subscription patterns and approve accurate ones
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <Badge variant="outline" className="flex items-center gap-1" data-testid="total-suggestions">
                <AlertCircle className="h-3 w-3" />
                {total} suggestions
              </Badge>
              {suggestions.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => clearAllMutation.mutate()}
                  disabled={clearAllMutation.isPending}
                  data-testid="clear-all-suggestions"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear All
                </Button>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 p-6">
          {/* Filters */}
          <div className="mb-6">
            <Tabs value={confidenceFilter} onValueChange={setConfidenceFilter}>
              <TabsList>
                <TabsTrigger value="" data-testid="filter-all">All Suggestions</TabsTrigger>
                <TabsTrigger value="high" data-testid="filter-high">High Confidence</TabsTrigger>
                <TabsTrigger value="medium" data-testid="filter-medium">Medium Confidence</TabsTrigger>
                <TabsTrigger value="low" data-testid="filter-low">Low Confidence</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Bulk Actions */}
          {suggestions.length > 0 && (
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <Checkbox
                      checked={selectedSuggestions.length === suggestions.length}
                      onCheckedChange={handleSelectAll}
                      data-testid="select-all-checkbox"
                    />
                    <span className="text-sm text-muted-foreground">
                      {selectedSuggestions.length} of {suggestions.length} selected
                    </span>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      onClick={handleApproveSelected}
                      disabled={selectedSuggestions.length === 0 || approveMutation.isPending}
                      data-testid="approve-selected"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Approve Selected ({selectedSuggestions.length})
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleRejectSelected}
                      disabled={selectedSuggestions.length === 0 || rejectMutation.isPending}
                      data-testid="reject-selected"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject Selected ({selectedSuggestions.length})
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Suggestions List */}
          {suggestions.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Suggestions Found</h3>
                <p className="text-muted-foreground" data-testid="no-suggestions">
                  No subscription suggestions available. Sync your emails to generate suggestions.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {suggestions.map((suggestion) => (
                <Card key={suggestion.id} className="border-l-4 border-l-primary">
                  <CardContent className="p-6">
                    <div className="flex items-start space-x-4">
                      <Checkbox
                        checked={selectedSuggestions.includes(suggestion.id)}
                        onCheckedChange={(checked) => handleSelectSuggestion(suggestion.id, !!checked)}
                        data-testid={`suggestion-checkbox-${suggestion.id}`}
                      />
                      
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-foreground" data-testid={`suggestion-service-${suggestion.id}`}>
                              {suggestion.serviceName}
                            </h3>
                            <p className="text-sm text-muted-foreground" data-testid={`suggestion-merchant-${suggestion.id}`}>
                              {suggestion.merchantName}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-bold text-foreground" data-testid={`suggestion-amount-${suggestion.id}`}>
                              {formatCurrency(suggestion.amount, suggestion.currency)}
                            </div>
                            <div className="text-sm text-muted-foreground" data-testid={`suggestion-frequency-${suggestion.id}`}>
                              {suggestion.frequency}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mb-4">
                          {getConfidenceBadge(suggestion.confidence, suggestion.confidenceScore)}
                          {suggestion.category && (
                            <Badge variant="outline" data-testid={`suggestion-category-${suggestion.id}`}>
                              {suggestion.category}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="flex items-center gap-1" data-testid={`suggestion-occurrences-${suggestion.id}`}>
                            <Mail className="h-3 w-3" />
                            {suggestion.occurrences} emails
                          </Badge>
                          {suggestion.recurrenceType && (
                            <Badge variant="outline" data-testid={`suggestion-recurrence-${suggestion.id}`}>
                              {suggestion.recurrenceType} pattern ({suggestion.recurrenceScore}%)
                            </Badge>
                          )}
                        </div>

                        <div className="bg-muted/50 rounded-lg p-4 mb-4">
                          <p className="text-sm text-muted-foreground" data-testid={`suggestion-reasoning-${suggestion.id}`}>
                            <strong>Detection Reasoning:</strong> {suggestion.reasoning}
                          </p>
                        </div>

                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <div className="flex items-center space-x-4">
                            <span data-testid={`suggestion-detected-${suggestion.id}`}>
                              Detected: {formatDate(suggestion.detectedAt!)}
                            </span>
                            {suggestion.nextBillingDate && (
                              <span className="flex items-center gap-1" data-testid={`suggestion-next-billing-${suggestion.id}`}>
                                <Calendar className="h-3 w-3" />
                                Next: {formatDate(suggestion.nextBillingDate)}
                              </span>
                            )}
                          </div>
                          <div className="flex space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => approveMutation.mutate([suggestion.id])}
                              disabled={approveMutation.isPending}
                              data-testid={`approve-suggestion-${suggestion.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => rejectMutation.mutate([suggestion.id])}
                              disabled={rejectMutation.isPending}
                              data-testid={`reject-suggestion-${suggestion.id}`}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <div className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, total)} of {total} suggestions
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  data-testid="previous-page"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground" data-testid="page-info">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  data-testid="next-page"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}