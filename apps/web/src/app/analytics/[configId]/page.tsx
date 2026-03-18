"use client";

import { use, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Eye,
  Users,
  TrendingDown,
  Clock,
  FileText,
  Globe,
  Monitor,
  Zap,
  Filter,
  Radio,
  Settings,
  ArrowUpRight,
  ArrowDownRight,
  Info,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Skeleton,
  Switch,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@uni-proxy-manager/ui";
import { useAnalyticsConfigs } from "@/hooks/use-analytics";
import { useAnalyticsSummary } from "@/hooks/use-analytics-data";
import type { AnalyticsQueryParams } from "@/lib/types";
import {
  PeriodSelector,
  getDateRangeForPeriod,
  type PeriodKey,
  type DateRange,
} from "./_components/period-selector";
import { FilterBar, type AnalyticsFilters } from "./_components/filter-bar";
import { OverviewTab } from "./_components/overview-tab";
import { PagesTab } from "./_components/pages-tab";
import { ReferrersTab } from "./_components/referrers-tab";
import { GeographyTab } from "./_components/geography-tab";
import { DevicesTab } from "./_components/devices-tab";
import { EventsTab } from "./_components/events-tab";
import { FunnelsTab } from "./_components/funnels-tab";
import { RealtimeTab } from "./_components/realtime-tab";
import { SettingsTab } from "./_components/settings-tab";

interface AnalyticsDashboardPageProps {
  params: Promise<{ configId: string }>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatComparisonChange(change: number): {
  text: string;
  isPositive: boolean;
  isNeutral: boolean;
} {
  if (change === 0) {
    return { text: "0%", isPositive: false, isNeutral: true };
  }
  const sign = change > 0 ? "+" : "";
  return {
    text: `${sign}${change.toFixed(1)}%`,
    isPositive: change > 0,
    isNeutral: false,
  };
}

export default function AnalyticsDashboardPage({ params }: AnalyticsDashboardPageProps) {
  const { configId } = use(params);

  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [dateRange, setDateRange] = useState<DateRange>(
    () => getDateRangeForPeriod("7d")
  );
  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const [showComparison, setShowComparison] = useState(true);

  const handleFiltersChange = useCallback((newFilters: AnalyticsFilters) => {
    setFilters(newFilters);
  }, []);

  // Merge date range with any active cross-dimensional filters
  const queryParams: AnalyticsQueryParams = useMemo(
    () => ({
      start: dateRange.start,
      end: dateRange.end,
      ...Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== "")
      ),
    }),
    [dateRange, filters]
  );

  // Fetch all configs and find the one matching configId
  const { data: configs, isLoading: configsLoading } = useAnalyticsConfigs();
  const config = useMemo(
    () => configs?.find((c) => c.id === configId),
    [configs, configId]
  );

  // Fetch summary data
  const { data: summaryData, isLoading: summaryLoading } = useAnalyticsSummary(
    configId,
    queryParams
  );

  if (configsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-2xl font-bold">Analytics configuration not found</h2>
        <p className="text-muted-foreground">
          The analytics configuration you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button asChild className="mt-4">
          <Link href="/analytics">Back to Analytics</Link>
        </Button>
      </div>
    );
  }

  const summary = summaryData?.summary;
  const comparison = summaryData?.comparison;

  const pageViewsChange = comparison
    ? formatComparisonChange(comparison.pageViewsChange)
    : null;
  const visitorsChange = comparison
    ? formatComparisonChange(comparison.uniqueVisitorsChange)
    : null;
  const bounceRateChange = comparison
    ? formatComparisonChange(comparison.bounceRateChange)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/analytics">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-6 w-6" />
              <h1 className="text-3xl font-bold">{config.domainHostname}</h1>
              <Badge className={config.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                {config.enabled ? "Active" : "Disabled"}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Analytics dashboard
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="comparison-toggle"
              checked={showComparison}
              onCheckedChange={setShowComparison}
            />
            <Label htmlFor="comparison-toggle" className="text-sm text-muted-foreground cursor-pointer">
              Compare
            </Label>
          </div>
          <PeriodSelector
            period={period}
            onPeriodChange={setPeriod}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
          />
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />

      {/* Summary metric cards */}
      <TooltipProvider>
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Page Views</CardTitle>
              <Eye className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {summary?.pageViews.toLocaleString() ?? 0}
                  </div>
                  {showComparison && pageViewsChange && !pageViewsChange.isNeutral && (
                    <p className={`text-xs flex items-center gap-1 ${
                      pageViewsChange.isPositive ? "text-green-600" : "text-red-600"
                    }`}>
                      {pageViewsChange.isPositive ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {pageViewsChange.text} from previous period
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1">
                Unique Visitors
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">
                      This is an approximation based on referrer-domain matching
                      and hashed session identifiers, not an exact count.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {summary?.uniqueVisitors.toLocaleString() ?? 0}
                  </div>
                  {showComparison && visitorsChange && !visitorsChange.isNeutral && (
                    <p className={`text-xs flex items-center gap-1 ${
                      visitorsChange.isPositive ? "text-green-600" : "text-red-600"
                    }`}>
                      {visitorsChange.isPositive ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {visitorsChange.text} from previous period
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Bounce Rate</CardTitle>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {summary?.bounceRate != null
                      ? `${summary.bounceRate.toFixed(1)}%`
                      : "0%"}
                  </div>
                  {showComparison && bounceRateChange && !bounceRateChange.isNeutral && (
                    <p className={`text-xs flex items-center gap-1 ${
                      bounceRateChange.isPositive ? "text-red-600" : "text-green-600"
                    }`}>
                      {bounceRateChange.isPositive ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {bounceRateChange.text} from previous period
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold">
                  {summary?.avgSessionDurationMs != null
                    ? formatDuration(summary.avgSessionDurationMs)
                    : "0s"}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </TooltipProvider>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">
            <BarChart3 className="mr-2 h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="pages">
            <FileText className="mr-2 h-4 w-4" />
            Pages
          </TabsTrigger>
          <TabsTrigger value="referrers">
            <ArrowUpRight className="mr-2 h-4 w-4" />
            Referrers
          </TabsTrigger>
          <TabsTrigger value="geography">
            <Globe className="mr-2 h-4 w-4" />
            Geography
          </TabsTrigger>
          <TabsTrigger value="devices">
            <Monitor className="mr-2 h-4 w-4" />
            Devices
          </TabsTrigger>
          <TabsTrigger value="events">
            <Zap className="mr-2 h-4 w-4" />
            Events
          </TabsTrigger>
          <TabsTrigger value="funnels">
            <Filter className="mr-2 h-4 w-4" />
            Funnels
          </TabsTrigger>
          <TabsTrigger value="realtime">
            <Radio className="mr-2 h-4 w-4" />
            Real-time
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <OverviewTab configId={configId} params={queryParams} showComparison={showComparison} />
        </TabsContent>

        <TabsContent value="pages" className="space-y-4">
          <PagesTab configId={configId} params={queryParams} />
        </TabsContent>

        <TabsContent value="referrers" className="space-y-4">
          <ReferrersTab configId={configId} params={queryParams} />
        </TabsContent>

        <TabsContent value="geography" className="space-y-4">
          <GeographyTab configId={configId} params={queryParams} />
        </TabsContent>

        <TabsContent value="devices" className="space-y-4">
          <DevicesTab configId={configId} params={queryParams} />
        </TabsContent>

        <TabsContent value="events" className="space-y-4">
          <EventsTab configId={configId} params={queryParams} />
        </TabsContent>

        <TabsContent value="funnels" className="space-y-4">
          <FunnelsTab configId={configId} />
        </TabsContent>

        <TabsContent value="realtime" className="space-y-4">
          <RealtimeTab configId={configId} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <SettingsTab config={config} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
