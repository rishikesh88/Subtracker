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
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
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
        return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200";
      case "cancelled":
        return "bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200";
      case "expiring_soon":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200";
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

  const getServiceIcon = (serviceName: string) => {
    const name = serviceName.toLowerCase();
    // Return different colored circles for different services
    if (name.includes("netflix")) return "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400";
    if (name.includes("spotify")) return "bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400";
    if (name.includes("github")) return "bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200";
    if (name.includes("adobe")) return "bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400";
    if (name.includes("youtube")) return "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400";
    if (name.includes("verizon") || name.includes("phone") || name.includes("wireless")) return "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400";
    return "bg-purple-100 text-purple-600 dark:bg-purple-950 dark:text-purple-400";
  };

  // Show EmptyDashboard if there are truly no subscriptions
  if (subscriptions.length === 0) {
    return <EmptyDashboard variant="no-subscriptions" />;
  }

  return (
    <div className="space-y-6">
      {/* Filters and Search */}
      <div className="bg-card rounded-lg border border-border p-6">
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

          {/* View Toggle */}
          <div className="flex border border-border rounded-md">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="rounded-r-none"
              data-testid="view-list"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
              className="rounded-l-none"
              data-testid="view-grid"
            >
              <Grid3X3 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Subscriptions List */}
      <div className="bg-card rounded-lg border border-border">
        <div className="p-6 border-b border-border">
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
          <div className="divide-y divide-border">
            {filteredSubscriptions.map((subscription) => (
              <div
                key={subscription.id}
                className="p-6 hover:bg-accent/50 transition-colors cursor-pointer"
                data-testid={`subscription-${subscription.id}`}
                onClick={() => setLocation(`/subscriptions/${subscription.id}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`w-12 h-12 ${getServiceIcon(subscription.serviceName)} rounded-lg flex items-center justify-center text-xl font-bold`}>
                      {subscription.serviceName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground" data-testid={`subscription-name-${subscription.id}`}>
                        {subscription.serviceName}
                      </h4>
                      <p className="text-sm text-muted-foreground capitalize" data-testid={`subscription-category-${subscription.id}`}>
                        {subscription.category || "Other"}
                      </p>
                      <div className="flex items-center space-x-4 mt-1">
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${getStatusBadgeClass(subscription.status)}`}
                          data-testid={`subscription-status-${subscription.id}`}
                        >
                          {subscription.status === "expiring_soon" ? "Expiring Soon" : subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
                        </span>
                        <span className="text-xs text-muted-foreground capitalize" data-testid={`subscription-frequency-${subscription.id}`}>
                          {subscription.frequency}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <p
                        className={`text-lg font-semibold ${subscription.status === "cancelled" ? "text-muted-foreground line-through" : "text-foreground"}`}
                        data-testid={`subscription-amount-${subscription.id}`}
                      >
                        {formatCurrency(subscription.amount, subscription.currency)}
                      </p>
                      <p className="text-sm text-muted-foreground" data-testid={`subscription-next-billing-${subscription.id}`}>
                        {subscription.status === "cancelled" 
                          ? `Ended: ${formatDate(subscription.lastEmailDate)}`
                          : `Next: ${formatDate(subscription.nextBillingDate)}`}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid={`subscription-last-email-${subscription.id}`}>
                        Last email: {formatDate(subscription.lastEmailDate)}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
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
