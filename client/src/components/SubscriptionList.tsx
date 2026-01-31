import { useState } from "react";
import { useLocation } from "wouter";
import { Search, List, Grid3X3, Pencil, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { type Subscription } from "@shared/schema";
import { EditSubscriptionModal } from "./EditSubscriptionModal";
import { EmptyDashboard } from "./EmptyDashboard";

interface SubscriptionListProps {
  subscriptions: Subscription[];
}

export function SubscriptionList({ subscriptions }: SubscriptionListProps) {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const filteredSubscriptions = subscriptions.filter((subscription) => {
    const matchesSearch = subscription.serviceName
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "all" || subscription.category === categoryFilter;
    const matchesStatus = statusFilter === "all" || subscription.status === statusFilter;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800 border border-green-200 dark:bg-green-950/50 dark:text-green-200 dark:border-green-900";
      case "cancelled":
        return "bg-gray-100 text-gray-800 border border-gray-200 dark:bg-gray-800/50 dark:text-gray-200 dark:border-gray-700";
      case "expiring_soon":
        return "bg-yellow-100 text-yellow-800 border border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-200 dark:border-yellow-900";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200";
    }
  };

  const formatCurrency = (amount: string, currency: string = "USD") => {
    const num = parseFloat(amount);
    
    // Validate currency code and fallback to INR for invalid ones
    const validCurrency = currency && currency.length === 3 && currency !== "unknown" 
      ? currency.toUpperCase() 
      : "INR";
    
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: validCurrency,
      }).format(num);
    } catch (error) {
      // If currency is still invalid, fallback to INR
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "INR",
      }).format(num);
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getOrdinalDate = (date: string | Date | null) => {
    if (!date) return "N/A";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "N/A";
    
    // Use regular date methods but ensure we handle the input consistently
    const day = d.getDate();
    const month = d.toLocaleDateString("en-US", { month: "short" });
    const year = d.getFullYear();

    let suffix = "th";
    if (day % 10 === 1 && day !== 11) suffix = "st";
    else if (day % 10 === 2 && day !== 12) suffix = "nd";
    else if (day % 10 === 3 && day !== 13) suffix = "rd";

    return `${day}${suffix} ${month} ${year}`;
  };

  const getServiceIcon = (serviceName: string) => {
    return "bg-gray-100 text-gray-800 border border-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700";
  };

  // Show EmptyDashboard if there are truly no subscriptions
  if (subscriptions.length === 0) {
    return <EmptyDashboard variant="no-subscriptions" />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Fixed: Filters and Search */}
      <div className="flex-shrink-0 bg-card rounded-lg border border-border p-6 mb-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-4 flex-1">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                type="text"
                placeholder="Search subscriptions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="search-subscriptions"
              />
            </div>

            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48" data-testid="filter-category">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="entertainment">Entertainment</SelectItem>
                <SelectItem value="software">Software</SelectItem>
                <SelectItem value="utilities">Utilities</SelectItem>
                <SelectItem value="shopping">Shopping</SelectItem>
                <SelectItem value="music">Music</SelectItem>
                <SelectItem value="cloud">Cloud</SelectItem>
                <SelectItem value="fitness">Fitness</SelectItem>
                <SelectItem value="news">News</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48" data-testid="filter-status">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Fixed: Title Header + Scrollable: Subscriptions List */}
      <div className="flex-1 flex flex-col min-h-0 bg-card rounded-lg border border-border">
        <div className="flex-shrink-0 p-6 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Your Subscriptions</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Automatically detected from your Gmail account
          </p>
        </div>

        {filteredSubscriptions.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground" data-testid="no-subscriptions">
              No subscriptions match your current filters.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {filteredSubscriptions.map((subscription) => (
              <div
                key={subscription.id}
                className="p-6 hover:bg-accent/50 transition-colors cursor-pointer"
                data-testid={`subscription-${subscription.id}`}
                onClick={() => setLocation(`/subscriptions/${subscription.id}`)}
              >
                <div className="flex flex-col space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className={`w-12 h-12 ${getServiceIcon(subscription.serviceName)} rounded-lg flex items-center justify-center text-xl font-bold`}>
                        {subscription.serviceName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-foreground font-sans" data-testid={`subscription-name-${subscription.id}`}>
                          {subscription.serviceName}
                        </h4>
                        <div className="flex items-center space-x-2 text-sm text-muted-foreground font-sans">
                          <span className="capitalize">{subscription.frequency}</span>
                          <span>•</span>
                          <span className="capitalize">{subscription.category || "Other"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span
                        className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${getStatusBadgeClass(subscription.status)}`}
                        data-testid={`subscription-status-${subscription.id}`}
                      >
                        {subscription.status === "expiring_soon" ? "Expiring Soon" : subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
                      </span>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>

                  {/* Price and Dates Section - Styled like Review Inbox */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid grid-cols-2 gap-3 order-1 md:order-1">
                      <div className="bg-accent/30 rounded-xl p-3 border border-border/50 shadow-sm">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1 font-sans">Last Email</p>
                        <p className="text-sm font-semibold text-foreground font-sans">
                          {getOrdinalDate(subscription.lastEmailDate)}
                        </p>
                      </div>
                      <div className="bg-accent/30 rounded-xl p-3 border border-border/50 shadow-sm">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1 font-sans">
                          {subscription.status === "cancelled" ? "Ended On" : "Next Payment"}
                        </p>
                        <p className="text-sm font-semibold text-foreground font-sans">
                          {subscription.status === "cancelled" 
                            ? getOrdinalDate(subscription.lastEmailDate)
                            : getOrdinalDate(subscription.nextBillingDate)}
                        </p>
                      </div>
                    </div>

                    <div className="bg-accent/30 rounded-xl p-4 flex items-center justify-between border border-border/50 shadow-sm order-2 md:order-2">
                      <span className="text-sm font-medium text-muted-foreground font-sans">Subscription Price</span>
                      <div className="text-right font-sans">
                        <span className="text-xl font-bold text-foreground" data-testid={`subscription-amount-${subscription.id}`}>
                          {formatCurrency(subscription.amount, subscription.currency)}
                        </span>
                        <span className="text-sm text-muted-foreground ml-1">/ {subscription.frequency}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredSubscriptions.length > 0 && filteredSubscriptions.length >= 10 && (
          <div className="p-6 border-t border-border text-center">
            <Button variant="ghost" data-testid="load-more-subscriptions">
              Load More Subscriptions
            </Button>
          </div>
        )}
      </div>

      <EditSubscriptionModal
        subscription={editingSubscription}
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
      />
    </div>
  );
}
