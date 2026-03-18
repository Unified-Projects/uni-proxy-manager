"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  BarChart3,
  Users,
  Clock,
  MousePointerClick,
  TrendingUp,
  TrendingDown,
  Eye,
  Activity,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@uni-proxy-manager/ui";
import { useAnalyticsSummary, useAnalyticsTimeseries } from "@/hooks/use-analytics-data";
import type { AnalyticsQueryParams } from "@/lib/types";

interface OverviewTabProps {
  configId: string;
  params: AnalyticsQueryParams;
  showComparison?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function ChangeIndicator({ value }: { value: number | undefined | null }) {
  if (value === undefined || value === null) return null;
  const isPositive = value > 0;
  const isZero = value === 0;

  if (isZero) {
    return <span className="text-xs text-muted-foreground">No change</span>;
  }

  return (
    <span
      className={`flex items-center gap-0.5 text-xs ${isPositive ? "text-green-600" : "text-red-600"}`}
    >
      {isPositive ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {isPositive ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

export function OverviewTab({ configId, params, showComparison = true }: OverviewTabProps) {
  const { data: summaryData, isLoading: summaryLoading } = useAnalyticsSummary(configId, params);
  const { data: timeseries, isLoading: timeseriesLoading } = useAnalyticsTimeseries(configId, params);

  const chartData = useMemo(() => {
    if (!timeseries || timeseries.length === 0) return [];
    return timeseries.map((bucket) => ({
      time: new Date(bucket.bucketStart).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      pageViews: bucket.pageViews,
      uniqueVisitors: bucket.uniqueVisitors,
      sessions: bucket.sessions,
    }));
  }, [timeseries]);

  if (summaryLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const summary = summaryData?.summary;
  const comparison = summaryData?.comparison;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Page Views</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(summary?.pageViews ?? 0)}
            </div>
            {showComparison && <ChangeIndicator value={comparison?.pageViewsChange} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unique Visitors</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(summary?.uniqueVisitors ?? 0)}
            </div>
            {showComparison && <ChangeIndicator value={comparison?.uniqueVisitorsChange} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sessions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(summary?.sessions ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bounce Rate</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(summary?.bounceRate ?? 0).toFixed(1)}%
            </div>
            {showComparison && <ChangeIndicator value={comparison?.bounceRateChange} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDuration(summary?.avgSessionDurationMs ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custom Events</CardTitle>
            <MousePointerClick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(summary?.customEvents ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Highlights */}
      {(summary?.topPage || summary?.topReferrer) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {summary?.topPage && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Top Page</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-mono truncate">{summary.topPage}</p>
              </CardContent>
            </Card>
          )}
          {summary?.topReferrer && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Top Referrer</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm truncate">{summary.topReferrer}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Timeseries chart */}
      <Card>
        <CardHeader>
          <CardTitle>Traffic Over Time</CardTitle>
          <CardDescription>
            Page views and unique visitors for the selected period
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeseriesLoading ? (
            <Skeleton className="h-72" />
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="time"
                  className="text-xs"
                  tick={{ fontSize: 12 }}
                />
                <YAxis className="text-xs" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--radius)",
                    fontSize: "12px",
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="pageViews"
                  name="Page Views"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="uniqueVisitors"
                  name="Unique Visitors"
                  stroke="hsl(var(--chart-2, 160 60% 45%))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <p>No timeseries data available for the selected period.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
