import { DollarSign, CheckCircle, Mail, BarChart } from "lucide-react";

interface StatsCardsProps {
  stats: {
    totalMonthly: number;
    activeCount: number;
    emailsAnalyzed: number;
    avgPerService: number;
    newThisMonth: number;
    changePercent: number;
  };
  userCurrency?: string;
}

// Currency formatting function (reused from SubscriptionList)
const formatCurrency = (amount: number, currency: string = "INR") => {
  const validCurrency = currency && currency.length === 3 && currency !== "unknown" 
    ? currency.toUpperCase() 
    : "INR";
  
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: validCurrency,
    }).format(amount);
  } catch (error) {
    // If currency is still invalid, fallback to INR
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "INR",
    }).format(amount);
  }
};

export function StatsCards({ stats, userCurrency = "INR" }: StatsCardsProps) {
  const cards = [
    {
      title: "Total Monthly",
      value: formatCurrency(stats.totalMonthly, userCurrency),
      icon: DollarSign,
      change: stats.changePercent !== 0 
        ? `${Math.abs(stats.changePercent)}% from last month`
        : "No change from last month",
      changeType: stats.changePercent > 0 ? "neutral" as const : stats.changePercent < 0 ? "positive" as const : "neutral" as const,
      bgColor: "bg-blue-100 dark:bg-blue-950",
      iconColor: "text-blue-600 dark:text-blue-400",
      testId: "stat-total-monthly"
    },
    {
      title: "Active Subscriptions",
      value: stats.activeCount.toString(),
      icon: CheckCircle,
      change: stats.newThisMonth > 0 
        ? `${stats.newThisMonth} new this month`
        : "No new subscriptions",
      changeType: "neutral" as const,
      bgColor: "bg-green-100 dark:bg-green-950",
      iconColor: "text-green-600 dark:text-green-400",
      testId: "stat-active-count"
    },
    {
      title: "Emails Analyzed",
      value: stats.emailsAnalyzed.toLocaleString(),
      icon: Mail,
      change: stats.emailsAnalyzed > 0 ? "From connected accounts" : "No emails yet",
      changeType: "neutral" as const,
      bgColor: "bg-purple-100 dark:bg-purple-950",
      iconColor: "text-purple-600 dark:text-purple-400",
      testId: "stat-emails-analyzed"
    },
    {
      title: "Avg. Per Service",
      value: formatCurrency(stats.avgPerService, userCurrency),
      icon: BarChart,
      change: stats.activeCount > 0 
        ? `Across ${stats.activeCount} subscription${stats.activeCount !== 1 ? 's' : ''}`
        : "No active subscriptions",
      changeType: "neutral" as const,
      bgColor: "bg-orange-100 dark:bg-orange-950",
      iconColor: "text-orange-600 dark:text-orange-400",
      testId: "stat-avg-per-service"
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {cards.map((card) => (
        <div key={card.title} className="bg-card rounded-lg border border-border p-6" data-testid={card.testId}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
              <p className="text-2xl font-bold text-foreground" data-testid={`${card.testId}-value`}>
                {card.value}
              </p>
            </div>
            <div className={`w-12 h-12 ${card.bgColor} rounded-lg flex items-center justify-center`}>
              <card.icon className={`${card.iconColor} w-6 h-6`} />
            </div>
          </div>
          <p
            className={`text-xs mt-2 ${
              card.changeType === "positive"
                ? "text-green-600 dark:text-green-400"
                : "text-muted-foreground"
            }`}
            data-testid={`${card.testId}-change`}
          >
            {card.changeType === "positive" && "↓ "}
            {card.change}
          </p>
        </div>
      ))}
    </div>
  );
}
