"use client";

import { useState, useMemo } from "react";
import {
  BarChart3,
  Users,
  FileText,
  Monitor,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@uni-proxy-manager/ui";
import { useDomainMetrics } from "@/hooks/use-metrics";
import { TrafficChart } from "@/components/metrics/traffic-chart";
import type { TrafficDataPoint } from "@/types/metrics";
import { formatNumber } from "@/lib/format";

interface DomainAnalyticsProps {
  domainId: string;
}

interface MetricsSummary {
  totalPageViews: number;
  totalUniqueVisitors: number;
  totalBytesIn: number;
  totalBytesOut: number;
  total2xx: number;
  total3xx: number;
  total4xx: number;
  total5xx: number;
  avgResponseTime: number;
}

interface MetricRecord {
  totalRequests?: number;
  uniqueVisitors?: number;
  httpRequests?: number;
  httpsRequests?: number;
  bytesIn?: number;
  bytesOut?: number;
  status2xx?: number;
  status3xx?: number;
  status4xx?: number;
  status5xx?: number;
  currentConnections?: number;
  maxConnections?: number;
  timestamp: string;
}

const defaultSummary: MetricsSummary = {
  totalPageViews: 0,
  totalUniqueVisitors: 0,
  totalBytesIn: 0,
  totalBytesOut: 0,
  total2xx: 0,
  total3xx: 0,
  total4xx: 0,
  total5xx: 0,
  avgResponseTime: 0,
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function DomainAnalytics({ domainId }: DomainAnalyticsProps) {
  const [period, setPeriod] = useState<"hour" | "day" | "week">("day");

  const { data, isLoading } = useDomainMetrics(domainId, period);

  const metrics = data?.metrics;

  const summary = useMemo((): MetricsSummary => {
    if (!metrics || metrics.length === 0) {
      return defaultSummary;
    }

    const aggregated = metrics.reduce(
      (acc: MetricsSummary, record: MetricRecord): MetricsSummary => ({
        totalPageViews: acc.totalPageViews + (record.totalRequests || 0),
        totalUniqueVisitors: acc.totalUniqueVisitors, // Will be set from deduplicated total
        totalBytesIn: acc.totalBytesIn + (record.bytesIn || 0),
        totalBytesOut: acc.totalBytesOut + (record.bytesOut || 0),
        total2xx: acc.total2xx + (record.status2xx || 0),
        total3xx: acc.total3xx + (record.status3xx || 0),
        total4xx: acc.total4xx + (record.status4xx || 0),
        total5xx: acc.total5xx + (record.status5xx || 0),
        avgResponseTime: acc.avgResponseTime,
      }),
      { ...defaultSummary }
    );

    // Use deduplicated total from API response
    aggregated.totalUniqueVisitors = data?.uniqueVisitorsTotal ?? 0;

    return aggregated;
  }, [metrics, data?.uniqueVisitorsTotal]);

  const trafficData = useMemo((): TrafficDataPoint[] => {
    if (!metrics) return [];

    return metrics
      .map((m: MetricRecord): TrafficDataPoint => ({
        timestamp: m.timestamp,
        totalRequests: m.totalRequests || 0,
        uniqueVisitors: m.uniqueVisitors || 0,
        httpRequests: m.httpRequests,
        httpsRequests: m.httpsRequests,
        status2xx: m.status2xx,
        status3xx: m.status3xx,
        status4xx: m.status4xx,
        status5xx: m.status5xx,
        bytesIn: m.bytesIn,
        bytesOut: m.bytesOut,
        currentConnections: m.currentConnections,
        maxConnections: m.maxConnections,
      }))
      .reverse();
  }, [metrics]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Domain Analytics</h3>
        <Select value={period} onValueChange={(v) => setPeriod(v as "hour" | "day" | "week")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hour">Last hour</SelectItem>
            <SelectItem value="day">Last 24 hours</SelectItem>
            <SelectItem value="week">Last 7 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(summary.totalPageViews)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unique Visitors</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(summary.totalUniqueVisitors)}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary.totalPageViews > 0
                ? ((summary.totalUniqueVisitors / summary.totalPageViews) * 100).toFixed(1)
                : 0}
              % of requests
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.totalPageViews
                ? (
                    ((summary.total2xx + summary.total3xx) /
                      summary.totalPageViews) *
                    100
                  ).toFixed(1)
                : 0}
              %
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.totalPageViews
                ? (
                    ((summary.total4xx + summary.total5xx) /
                      summary.totalPageViews) *
                    100
                  ).toFixed(1)
                : 0}
              %
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Bandwidth
            </CardTitle>
            <CardDescription>Data transfer</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Data In</span>
                <span className="text-sm font-mono">
                  {formatBytes(summary.totalBytesIn)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Data Out</span>
                <span className="text-sm font-mono">
                  {formatBytes(summary.totalBytesOut)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm font-medium">Total</span>
                <span className="text-sm font-mono font-medium">
                  {formatBytes(summary.totalBytesIn + summary.totalBytesOut)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Response Codes
            </CardTitle>
            <CardDescription>HTTP status breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-green-600">2xx Success</span>
                <span className="text-sm font-mono">
                  {summary.total2xx.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-blue-600">3xx Redirect</span>
                <span className="text-sm font-mono">
                  {summary.total3xx.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-yellow-600">4xx Client Error</span>
                <span className="text-sm font-mono">
                  {summary.total4xx.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-red-600">5xx Server Error</span>
                <span className="text-sm font-mono">
                  {summary.total5xx.toLocaleString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2">
          <TrafficChart
            data={trafficData}
            title="Traffic Over Time"
            uniqueVisitorsTotal={data?.uniqueVisitorsTotal}
          />
        </div>
      </div>
    </div>
  );
}
