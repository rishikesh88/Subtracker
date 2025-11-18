import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle, AlertCircle, Clock, DollarSign, Sparkles } from "lucide-react";

interface LLMSuggestion {
  serviceName: string;
  merchantName: string;
  amount: number;
  currency: string;
  frequency: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore?: number; // 0.00-1.00
  reasoning: string;
  isActive: boolean;
  occurrences?: number; // Number of supporting emails
  lastSeen?: Date | string; // Last seen timestamp
  detectedAt?: Date | string; // Detection timestamp
}

interface LLMSuggestionsModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  suggestions: {
    high: LLMSuggestion[];
    medium: LLMSuggestion[];
    low: LLMSuggestion[];
  };
  onReview: (accepted: string[], rejected: string[]) => void;
  isReviewing?: boolean;
}

export function LLMSuggestionsModal({ 
  open, 
  onClose, 
  sessionId, 
  suggestions, 
  onReview,
  isReviewing = false
}: LLMSuggestionsModalProps) {
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  const allSuggestions = [...suggestions.high, ...suggestions.medium, ...suggestions.low];
  const totalSuggestions = allSuggestions.length;

  // Auto-select high confidence suggestions when modal opens
  useEffect(() => {
    if (open && suggestions.high.length > 0) {
      const highConfidenceNames = suggestions.high.map(s => s.serviceName);
      setSelectedSuggestions(new Set(highConfidenceNames));
    }
  }, [open, suggestions.high]);

  const handleToggleSelection = (serviceName: string) => {
    const newSelected = new Set(selectedSuggestions);
    if (newSelected.has(serviceName)) {
      newSelected.delete(serviceName);
    } else {
      newSelected.add(serviceName);
    }
    setSelectedSuggestions(newSelected);
  };

  const handleSelectAllHigh = () => {
    const highConfidenceNames = suggestions.high.map(s => s.serviceName);
    const combined = Array.from(selectedSuggestions).concat(highConfidenceNames);
    setSelectedSuggestions(new Set(combined));
  };

  const handleSelectAll = () => {
    const allNames = allSuggestions.map(s => s.serviceName);
    setSelectedSuggestions(new Set(allNames));
  };

  const handleClearSelection = () => {
    setSelectedSuggestions(new Set());
  };

  const handleReview = () => {
    const accepted = Array.from(selectedSuggestions);
    const rejected = allSuggestions
      .filter(s => !selectedSuggestions.has(s.serviceName))
      .map(s => s.serviceName);
    
    onReview(accepted, rejected);
  };

  const getConfidenceIcon = (confidence: string) => {
    switch (confidence) {
      case 'high': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'medium': return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case 'low': return <Clock className="h-4 w-4 text-gray-600" />;
      default: return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'bg-green-100 text-green-800 border-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    if (currency === 'INR') {
      return `₹${amount.toLocaleString('en-IN')}`;
    }
    return `$${amount.toFixed(2)}`;
  };

  const renderSuggestionGroup = (title: string, groupSuggestions: LLMSuggestion[], confidence: string) => {
    if (groupSuggestions.length === 0) return null;

    const isHighConfidence = confidence === 'high';

    return (
      <div 
        className={`mb-6 ${isHighConfidence ? 'p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border-2 border-green-200 dark:border-green-800' : ''}`}
        data-testid={`suggestions-${confidence}`}
      >
        <div className="flex items-center gap-2 mb-3">
          {getConfidenceIcon(confidence)}
          <h3 className={`text-lg font-semibold ${isHighConfidence ? 'text-green-900 dark:text-green-100' : ''}`}>
            {title}
            {isHighConfidence && <span className="ml-2 text-sm font-normal text-green-700 dark:text-green-300">(Recommended)</span>}
          </h3>
          <Badge variant="outline" className={getConfidenceColor(confidence)}>
            {groupSuggestions.length} found
          </Badge>
        </div>
        
        <div className="grid gap-3">
          {groupSuggestions.map((suggestion) => (
            <Card 
              key={suggestion.serviceName} 
              className={`cursor-pointer transition-all ${
                selectedSuggestions.has(suggestion.serviceName) 
                  ? 'ring-2 ring-primary bg-primary/5 dark:bg-primary/10' 
                  : `hover:bg-accent/50 ${isHighConfidence ? 'bg-white dark:bg-gray-900 shadow-sm' : ''}`
              }`}
              onClick={() => handleToggleSelection(suggestion.serviceName)}
              data-testid={`suggestion-${suggestion.serviceName}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Checkbox 
                      checked={selectedSuggestions.has(suggestion.serviceName)}
                      onChange={() => handleToggleSelection(suggestion.serviceName)}
                      data-testid={`checkbox-${suggestion.serviceName}`}
                    />
                    <div>
                      <CardTitle className="text-base">{suggestion.serviceName}</CardTitle>
                      <CardDescription>{suggestion.merchantName}</CardDescription>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-lg font-semibold">
                      <DollarSign className="h-4 w-4" />
                      {formatCurrency(suggestion.amount, suggestion.currency)}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {suggestion.frequency}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                  <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded-md">{suggestion.category}</span>
                  <Badge 
                    variant={suggestion.isActive ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {suggestion.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                
                {/* Enhanced Metadata */}
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-2">
                  {suggestion.confidenceScore && (
                    <div className="flex items-center gap-1" data-testid={`confidence-score-${suggestion.serviceName}`}>
                      <CheckCircle className="h-3 w-3" />
                      <span>{Math.round(suggestion.confidenceScore * 100)}% confidence</span>
                    </div>
                  )}
                  {suggestion.occurrences && suggestion.occurrences > 1 && (
                    <div className="flex items-center gap-1" data-testid={`occurrences-${suggestion.serviceName}`}>
                      <span className="font-medium">{suggestion.occurrences} emails</span>
                      <span>found</span>
                    </div>
                  )}
                  {suggestion.lastSeen && (
                    <div className="flex items-center gap-1" data-testid={`last-seen-${suggestion.serviceName}`}>
                      <Clock className="h-3 w-3" />
                      <span>Last: {new Date(suggestion.lastSeen).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
                
                <p className="text-xs text-gray-500 mt-2">{suggestion.reasoning}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto" data-testid="llm-suggestions-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI-Detected Subscription Suggestions
          </DialogTitle>
          <DialogDescription>
            Review {totalSuggestions} subscription{totalSuggestions !== 1 ? 's' : ''} detected by AI analysis.
            High confidence suggestions are auto-selected for your convenience.
          </DialogDescription>
        </DialogHeader>

        {/* Batch Actions */}
        {totalSuggestions > 0 && (
          <div className="flex flex-wrap gap-2 pb-4 border-b border-border">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleSelectAllHigh}
              disabled={suggestions.high.length === 0}
              data-testid="button-select-all-high"
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Select All High ({suggestions.high.length})
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleSelectAll}
              data-testid="button-select-all"
            >
              Select All ({totalSuggestions})
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleClearSelection}
              disabled={selectedSuggestions.size === 0}
              data-testid="button-clear-selection"
            >
              Clear Selection
            </Button>
          </div>
        )}
        
        <div className="space-y-6">
          {renderSuggestionGroup("High Confidence", suggestions.high, "high")}
          {renderSuggestionGroup("Medium Confidence", suggestions.medium, "medium")}
          {renderSuggestionGroup("Low Confidence", suggestions.low, "low")}
          
          {totalSuggestions === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Clock className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No subscription suggestions found</p>
              <p className="text-sm">Try connecting more emails or check back later</p>
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between pt-6 border-t">
          <div className="text-sm text-gray-600">
            {selectedSuggestions.size} of {totalSuggestions} selected
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              onClick={handleReview} 
              disabled={isReviewing || selectedSuggestions.size === 0}
              data-testid="button-accept-suggestions"
            >
              {isReviewing ? "Processing..." : `Accept ${selectedSuggestions.size} Suggestions`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}