import { useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, AlertCircle, ChevronLeft, ChevronRight, Trash2, Eye } from "lucide-react";

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

  // Fetch suggestions with pagination
  const { data: suggestionsData = { suggestions: [], total: 0 }, isLoading, refetch } = useQuery<{
    suggestions: SubscriptionSuggestion[];
    total: number;
  }>({
    queryKey: [`/api/suggestions?userId=${userId}&page=${currentPage}&pageSize=${pageSize}&minConfidence=${confidenceFilter}`],
    enabled: !!userId && open, // Only fetch when modal is open
  });

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
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: [`/api/stats?userId=${userId}`] });
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
        description: `Successfully rejected ${data.rejected} suggestions`,
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
          {/* Controls - Sticky header */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b">
            <div className="flex items-center gap-4">
              <Checkbox
                checked={selectedSuggestions.length === suggestions.length && suggestions.length > 0}
                onCheckedChange={handleSelectAll}
                data-testid="select-all-suggestions"
              />
              <span className="text-sm text-muted-foreground">
                {selectedSuggestions.length} of {suggestions.length} selected
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Tabs value={confidenceFilter} onValueChange={setConfidenceFilter} className="w-auto">
                <TabsList className="grid grid-cols-4 w-auto">
                  <TabsTrigger value="" className="text-xs px-3">All</TabsTrigger>
                  <TabsTrigger value="high" className="text-xs px-3">High</TabsTrigger>
                  <TabsTrigger value="medium" className="text-xs px-3">Medium</TabsTrigger>
                  <TabsTrigger value="low" className="text-xs px-3">Low</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Suggestions grid - Scrollable content */}
          <div className="flex-1 overflow-y-auto max-h-96">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : suggestions.length === 0 ? (
              <div className="text-center py-8">
                <Eye className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No suggestions found</p>
                <p className="text-sm text-muted-foreground">Try adjusting the confidence filter or sync more emails</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {suggestions.map((suggestion) => (
                  <Card 
                    key={suggestion.id} 
                    className={`hover:shadow-md transition-shadow ${
                      selectedSuggestions.includes(suggestion.id) 
                        ? 'ring-2 ring-primary' 
                        : ''
                    }`}
                    data-testid={`suggestion-card-${suggestion.id}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedSuggestions.includes(suggestion.id)}
                            onCheckedChange={(checked) => handleSuggestionSelect(suggestion.id, checked as boolean)}
                            data-testid={`suggestion-checkbox-${suggestion.id}`}
                          />
                          <div>
                            <CardTitle className="text-sm font-medium" data-testid={`suggestion-name-${suggestion.id}`}>
                              {suggestion.serviceName}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {suggestion.merchantName || "Unknown merchant"}
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
            <Trash2 className="h-4 w-4 mr-2" />
            {clearMutation.isPending ? "Clearing..." : "Clear All"}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => rejectMutation.mutate(selectedSuggestions)}
              disabled={selectedSuggestions.length === 0 || rejectMutation.isPending}
              data-testid="reject-suggestions"
            >
              <XCircle className="h-4 w-4 mr-2" />
              {rejectMutation.isPending ? "Rejecting..." : `Reject ${selectedSuggestions.length}`}
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