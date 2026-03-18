"use client";

import { useState, useMemo } from "react";
import {
  BarChart3,
  Globe,
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
import {
  useSiteAnalyticsSummary,
  useSiteVisitors,
  useSiteGeography,
  useSiteReferrers,
  useSitePages,
  useSiteDevices,
} from "@/hooks";
import { useSiteDomains } from "@/hooks/use-sites";

function getPeriodDates(period: string): { start: string; end: string } {
  const end = new Date();
  const start = new Date();

  switch (period) {
    case "24h":
      start.setHours(start.getHours() - 24);
      break;
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
    default:
      start.setDate(start.getDate() - 7);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

interface SiteAnalyticsProps {
  siteId: string;
}

export function SiteAnalytics({ siteId }: SiteAnalyticsProps) {
  const [period, setPeriod] = useState("7d");
  const [selectedDomain, setSelectedDomain] = useState<string>("all");
  const dateRange = useMemo(() => getPeriodDates(period), [period]);

  const { data: domains } = useSiteDomains(siteId);
  const { data: summary, isLoading: summaryLoading } = useSiteAnalyticsSummary(
    siteId,
    dateRange
  );
  const { data: visitors } = useSiteVisitors(siteId, dateRange);
  const { data: geography } = useSiteGeography(siteId, dateRange);
  const { data: referrers } = useSiteReferrers(siteId, dateRange);
  const { data: pages } = useSitePages(siteId, dateRange);
  const { data: devices } = useSiteDevices(siteId, dateRange);

  if (summaryLoading) {
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
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-medium">Site Analytics</h3>
          <Select value={selectedDomain} onValueChange={setSelectedDomain}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All domains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All domains</SelectItem>
              {domains?.map((domain) => (
                <SelectItem key={domain.id} value={domain.hostname}>
                  {domain.hostname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Page Views</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.summary.totalPageViews.toLocaleString() ?? 0}
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
              {summary?.summary.totalUniqueVisitors.toLocaleString() ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.summary.avgResponseTime ?? 0}ms
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
              {summary?.summary.totalPageViews
                ? (
                    ((summary.summary.total4xx + summary.summary.total5xx) /
                      summary.summary.totalPageViews) *
                    100
                  ).toFixed(2)
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
              <Globe className="h-4 w-4" />
              Top Countries
            </CardTitle>
            <CardDescription>Visitors by country</CardDescription>
          </CardHeader>
          <CardContent>
            {geography && geography.length > 0 ? (
              <div className="space-y-2">
                {geography.slice(0, 10).map((country) => (
                  <div
                    key={country.country}
                    className="flex items-center justify-between"
                  >
                    <span className="text-sm">{country.country}</span>
                    <span className="text-sm text-muted-foreground">
                      {country.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data available</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Top Pages
            </CardTitle>
            <CardDescription>Most visited pages</CardDescription>
          </CardHeader>
          <CardContent>
            {pages && pages.length > 0 ? (
              <div className="space-y-2">
                {pages.slice(0, 10).map((page) => (
                  <div
                    key={page.path}
                    className="flex items-center justify-between"
                  >
                    <span className="text-sm font-mono truncate max-w-[200px]">
                      {page.path}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {page.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data available</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4" />
              Top Referrers
            </CardTitle>
            <CardDescription>Traffic sources</CardDescription>
          </CardHeader>
          <CardContent>
            {referrers && referrers.length > 0 ? (
              <div className="space-y-2">
                {referrers.slice(0, 10).map((referrer) => (
                  <div
                    key={referrer.domain}
                    className="flex items-center justify-between"
                  >
                    <span className="text-sm truncate max-w-[200px]">
                      {referrer.domain || "(direct)"}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {referrer.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data available</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Devices
            </CardTitle>
            <CardDescription>Device breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {devices?.devices ? (
              <div className="space-y-3">
                {Object.entries(devices.devices).map(([device, data]) => (
                  <div key={device}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm capitalize">{device}</span>
                      <span className="text-sm text-muted-foreground">
                        {data.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${data.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data available</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
