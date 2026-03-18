"use client";

import { use, useState, useMemo, useCallback, useEffect } from "react";
import {
  BarChart3,
  Globe,
  Users,
  Eye,
  Timer,
  MousePointerClick,
  ArrowUpRight,
  ArrowDownRight,
  Monitor,
  Smartphone,
  Tablet,
  FileText,
  Link as LinkIcon,
  MapPin,
  Tag,
  Download,
  Lock,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uni-proxy-manager/ui";
import { analyticsPublicApi } from "@/lib/api";
import type {
  AnalyticsSummary,
  AnalyticsTimeseries,
  AnalyticsPages,
  AnalyticsReferrers,
  AnalyticsGeography,
  AnalyticsDevices,
  AnalyticsUTM,
  AnalyticsQueryParams,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardInfo {
  domainHostname: string;
  dashboardName: string;
}

interface PublicDashboardPageProps {
  params: Promise<{ token: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.round(secs % 60);
  return `${mins}m ${remSecs}s`;
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatChange(value: number): { text: string; positive: boolean } {
  const pct = (value * 100).toFixed(1);
  if (value >= 0) {
    return { text: `+${pct}%`, positive: true };
  }
  return { text: `${pct}%`, positive: false };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PasswordForm({
  onSubmit,
  isLoading,
  error,
}: {
  onSubmit: (password: string) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>Password Required</CardTitle>
          <CardDescription>
            This analytics dashboard is password-protected. Please enter the
            password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter dashboard password"
                autoFocus
                disabled={isLoading}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={isLoading || !password}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                "Unlock Dashboard"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCards({
  summary,
  isLoading,
}: {
  summary: AnalyticsSummary | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const { summary: s, comparison } = summary;

  const cards = [
    {
      title: "Page Views",
      value: formatNumber(s.pageViews),
      icon: Eye,
      change: comparison?.pageViewsChange,
    },
    {
      title: "Unique Visitors",
      value: formatNumber(s.uniqueVisitors),
      icon: Users,
      change: comparison?.uniqueVisitorsChange,
    },
    {
      title: "Bounce Rate",
      value: formatPercentage(s.bounceRate),
      icon: MousePointerClick,
      change: comparison?.bounceRateChange,
      invertChange: true,
    },
    {
      title: "Avg Session",
      value: formatDuration(s.avgSessionDurationMs),
      icon: Timer,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const change =
          card.change !== undefined && card.change !== null
            ? formatChange(card.change)
            : null;
        // For bounce rate a decrease is good.
        const isPositive = change
          ? card.invertChange
            ? !change.positive
            : change.positive
          : false;

        return (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              {change && (
                <p
                  className={`text-xs ${isPositive ? "text-green-600" : "text-red-600"} flex items-center gap-1 mt-1`}
                >
                  {isPositive ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {change.text} vs previous period
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TimeseriesSection({
  data,
  isLoading,
}: {
  data: AnalyticsTimeseries | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  if (!data || data.timeseries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Traffic Over Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No data available for this period</p>
        </CardContent>
      </Card>
    );
  }

  const maxPv = Math.max(...data.timeseries.map((b) => b.pageViews), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Traffic Over Time
        </CardTitle>
        <CardDescription>Page views and unique visitors per bucket</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.timeseries.map((bucket, i) => {
            const barWidth = Math.max((bucket.pageViews / maxPv) * 100, 2);
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">
                  {new Date(bucket.bucketStart).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <div className="relative flex-1">
                  <div
                    className="h-5 rounded bg-primary/20"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <div className="flex gap-4 shrink-0 text-xs">
                  <span>{formatNumber(bucket.pageViews)} views</span>
                  <span className="text-muted-foreground">
                    {formatNumber(bucket.uniqueVisitors)} visitors
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PagesSection({
  data,
  isLoading,
}: {
  data: AnalyticsPages | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Top Pages
        </CardTitle>
        <CardDescription>Most visited pages</CardDescription>
      </CardHeader>
      <CardContent>
        {data.pages.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground border-b pb-2">
              <span>Path</span>
              <div className="flex gap-6">
                <span>Views</span>
                <span>Visitors</span>
              </div>
            </div>
            {data.pages.slice(0, 15).map((page) => (
              <div key={page.pathname} className="flex items-center justify-between">
                <span className="text-sm truncate max-w-[60%]" title={page.pathname}>
                  {page.pathname}
                </span>
                <div className="flex gap-6 text-sm text-right">
                  <span className="w-16 text-right">{formatNumber(page.pageViews)}</span>
                  <span className="w-16 text-right text-muted-foreground">
                    {formatNumber(page.uniqueVisitors)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No data available</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReferrersSection({
  data,
  isLoading,
}: {
  data: AnalyticsReferrers | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LinkIcon className="h-4 w-4" />
          Top Referrers
        </CardTitle>
        <CardDescription>Where your visitors come from</CardDescription>
      </CardHeader>
      <CardContent>
        {data.referrers.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground border-b pb-2">
              <span>Domain</span>
              <div className="flex gap-6">
                <span>Visitors</span>
                <span>Views</span>
              </div>
            </div>
            {data.referrers.slice(0, 15).map((ref) => (
              <div key={ref.domain} className="flex items-center justify-between">
                <span className="text-sm truncate max-w-[60%]">
                  {ref.domain || "(direct)"}
                </span>
                <div className="flex gap-6 text-sm text-right">
                  <span className="w-16 text-right">{formatNumber(ref.visitors)}</span>
                  <span className="w-16 text-right text-muted-foreground">
                    {formatNumber(ref.pageViews)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No data available</p>
        )}
      </CardContent>
    </Card>
  );
}

function GeographySection({
  data,
  isLoading,
}: {
  data: AnalyticsGeography | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Geography
        </CardTitle>
        <CardDescription>Visitors by country</CardDescription>
      </CardHeader>
      <CardContent>
        {data.countries.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground border-b pb-2">
              <span>Country</span>
              <div className="flex gap-6">
                <span>Visitors</span>
                <span>Views</span>
              </div>
            </div>
            {data.countries.slice(0, 20).map((entry) => (
              <div key={entry.countryCode} className="flex items-center justify-between">
                <span className="text-sm">{entry.countryCode}</span>
                <div className="flex gap-6 text-sm text-right">
                  <span className="w-16 text-right">{formatNumber(entry.visitors)}</span>
                  <span className="w-16 text-right text-muted-foreground">
                    {formatNumber(entry.pageViews)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No data available</p>
        )}
      </CardContent>
    </Card>
  );
}

function DevicesSection({
  data,
  isLoading,
}: {
  data: AnalyticsDevices | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  if (!data) return null;

  const total =
    data.devices.desktop + data.devices.mobile + data.devices.tablet + data.devices.other;

  const deviceTypes = [
    { name: "Desktop", count: data.devices.desktop, icon: Monitor },
    { name: "Mobile", count: data.devices.mobile, icon: Smartphone },
    { name: "Tablet", count: data.devices.tablet, icon: Tablet },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="h-4 w-4" />
          Devices
        </CardTitle>
        <CardDescription>Visitor device breakdown</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          {deviceTypes.map((device) => {
            const Icon = device.icon;
            const pct = total > 0 ? ((device.count / total) * 100).toFixed(1) : "0";
            return (
              <div key={device.name} className="text-center space-y-1">
                <Icon className="h-5 w-5 mx-auto text-muted-foreground" />
                <p className="text-lg font-bold">{pct}%</p>
                <p className="text-xs text-muted-foreground">{device.name}</p>
              </div>
            );
          })}
        </div>

        {data.browsers.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Browsers</h4>
            <div className="space-y-2">
              {data.browsers.slice(0, 8).map((b) => (
                <div key={b.name} className="flex items-center justify-between">
                  <span className="text-sm">{b.name || "Unknown"}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatNumber(b.count)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.os.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Operating Systems</h4>
            <div className="space-y-2">
              {data.os.slice(0, 8).map((o) => (
                <div key={o.name} className="flex items-center justify-between">
                  <span className="text-sm">{o.name || "Unknown"}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatNumber(o.count)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UTMSection({
  data,
  isLoading,
}: {
  data: AnalyticsUTM | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  if (!data) return null;

  const hasSources = data.sources.length > 0;
  const hasMediums = data.mediums.length > 0;
  const hasCampaigns = data.campaigns.length > 0;

  if (!hasSources && !hasMediums && !hasCampaigns) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            UTM Campaigns
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No UTM data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-4 w-4" />
          UTM Campaigns
        </CardTitle>
        <CardDescription>Campaign tracking data</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasSources && (
          <div>
            <h4 className="text-sm font-medium mb-2">Sources</h4>
            <div className="space-y-2">
              {data.sources.slice(0, 10).map((s) => (
                <div key={s.source} className="flex items-center justify-between">
                  <span className="text-sm">{s.source}</span>
                  <div className="flex gap-4 text-sm">
                    <span>{formatNumber(s.visitors)} visitors</span>
                    <span className="text-muted-foreground">{formatNumber(s.pageViews)} views</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasMediums && (
          <div>
            <h4 className="text-sm font-medium mb-2">Mediums</h4>
            <div className="space-y-2">
              {data.mediums.slice(0, 10).map((m) => (
                <div key={m.medium} className="flex items-center justify-between">
                  <span className="text-sm">{m.medium}</span>
                  <div className="flex gap-4 text-sm">
                    <span>{formatNumber(m.visitors)} visitors</span>
                    <span className="text-muted-foreground">{m.percentage.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasCampaigns && (
          <div>
            <h4 className="text-sm font-medium mb-2">Campaigns</h4>
            <div className="space-y-2">
              {data.campaigns.slice(0, 10).map((c) => (
                <div key={c.campaign} className="flex items-center justify-between">
                  <span className="text-sm">{c.campaign}</span>
                  <div className="flex gap-4 text-sm">
                    <span>{formatNumber(c.visitors)} visitors</span>
                    <span className="text-muted-foreground">{formatNumber(c.pageViews)} views</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function PublicAnalyticsDashboardPage({ params }: PublicDashboardPageProps) {
  const { token } = use(params);

  // Verification state
  const [verifyState, setVerifyState] = useState<
    "loading" | "not-found" | "password-required" | "ready"
  >("loading");
  const [dashboardInfo, setDashboardInfo] = useState<DashboardInfo | null>(null);

  // Auth state
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Data state
  const [period, setPeriod] = useState("7d");
  const dateRange = useMemo(() => getPeriodDates(period), [period]);
  const queryParams: AnalyticsQueryParams = useMemo(
    () => ({ start: dateRange.start, end: dateRange.end }),
    [dateRange]
  );

  const [summaryData, setSummaryData] = useState<AnalyticsSummary | null>(null);
  const [timeseriesData, setTimeseriesData] = useState<AnalyticsTimeseries | null>(null);
  const [pagesData, setPagesData] = useState<AnalyticsPages | null>(null);
  const [referrersData, setReferrersData] = useState<AnalyticsReferrers | null>(null);
  const [geographyData, setGeographyData] = useState<AnalyticsGeography | null>(null);
  const [devicesData, setDevicesData] = useState<AnalyticsDevices | null>(null);
  const [utmData, setUtmData] = useState<AnalyticsUTM | null>(null);

  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Verify token on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        const result = await analyticsPublicApi.verify(token);
        if (cancelled) return;

        if (!result.valid) {
          setVerifyState("not-found");
          return;
        }

        setDashboardInfo({
          domainHostname: result.domainHostname ?? "",
          dashboardName: result.dashboardName ?? "Analytics",
        });

        if (result.requiresPassword) {
          setVerifyState("password-required");
        } else {
          setVerifyState("ready");
        }
      } catch {
        if (!cancelled) {
          setVerifyState("not-found");
        }
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // -------------------------------------------------------------------------
  // Password authentication
  // -------------------------------------------------------------------------
  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      setAuthLoading(true);
      setAuthError(null);

      try {
        const result = await analyticsPublicApi.authenticate(token, password);
        if (result.authenticated && result.sessionToken) {
          setSessionToken(result.sessionToken);
          setVerifyState("ready");
        } else {
          setAuthError("Authentication failed. Please try again.");
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Incorrect password. Please try again.";
        setAuthError(message);
      } finally {
        setAuthLoading(false);
      }
    },
    [token]
  );

  // -------------------------------------------------------------------------
  // Fetch analytics data
  // -------------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    if (verifyState !== "ready") return;

    setDataLoading(true);
    setDataError(null);

    try {
      const [summary, timeseries, pages, referrers, geography, devices, utm] =
        await Promise.allSettled([
          analyticsPublicApi.getSummary(token, queryParams, sessionToken ?? undefined),
          analyticsPublicApi.getTimeseries(token, queryParams, sessionToken ?? undefined),
          analyticsPublicApi.getPages(token, queryParams, sessionToken ?? undefined),
          analyticsPublicApi.getReferrers(token, queryParams, sessionToken ?? undefined),
          analyticsPublicApi.getGeography(token, queryParams, sessionToken ?? undefined),
          analyticsPublicApi.getDevices(token, queryParams, sessionToken ?? undefined),
          analyticsPublicApi.getUTM(token, queryParams, sessionToken ?? undefined),
        ]);

      setSummaryData(summary.status === "fulfilled" ? summary.value : null);
      setTimeseriesData(timeseries.status === "fulfilled" ? timeseries.value : null);
      setPagesData(pages.status === "fulfilled" ? pages.value : null);
      setReferrersData(referrers.status === "fulfilled" ? referrers.value : null);
      setGeographyData(geography.status === "fulfilled" ? geography.value : null);
      setDevicesData(devices.status === "fulfilled" ? devices.value : null);
      setUtmData(utm.status === "fulfilled" ? utm.value : null);
    } catch {
      setDataError("Failed to load analytics data. Please refresh the page.");
    } finally {
      setDataLoading(false);
    }
  }, [verifyState, token, queryParams, sessionToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // -------------------------------------------------------------------------
  // Export handlers
  // -------------------------------------------------------------------------
  const handleExportCsv = useCallback(async () => {
    try {
      await analyticsPublicApi.exportCsv(token, queryParams, sessionToken ?? undefined);
    } catch {
      console.error("[Analytics] CSV export failed");
    }
  }, [token, queryParams, sessionToken]);

  const handleExportJson = useCallback(async () => {
    try {
      const data = await Promise.allSettled([
        analyticsPublicApi.getSummary(token, queryParams, sessionToken ?? undefined),
        analyticsPublicApi.getTimeseries(token, queryParams, sessionToken ?? undefined),
        analyticsPublicApi.getPages(token, queryParams, sessionToken ?? undefined),
        analyticsPublicApi.getReferrers(token, queryParams, sessionToken ?? undefined),
        analyticsPublicApi.getGeography(token, queryParams, sessionToken ?? undefined),
        analyticsPublicApi.getDevices(token, queryParams, sessionToken ?? undefined),
        analyticsPublicApi.getUTM(token, queryParams, sessionToken ?? undefined),
      ]);

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        period: queryParams,
        summary: data[0].status === "fulfilled" ? data[0].value : null,
        timeseries: data[1].status === "fulfilled" ? data[1].value : null,
        pages: data[2].status === "fulfilled" ? data[2].value : null,
        referrers: data[3].status === "fulfilled" ? data[3].value : null,
        geography: data[4].status === "fulfilled" ? data[4].value : null,
        devices: data[5].status === "fulfilled" ? data[5].value : null,
        utm: data[6].status === "fulfilled" ? data[6].value : null,
      };

      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analytics-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Silently fail -- the user will notice the file did not download.
    }
  }, [token, queryParams, sessionToken]);

  // -------------------------------------------------------------------------
  // Render: Loading state
  // -------------------------------------------------------------------------
  if (verifyState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: Not found
  // -------------------------------------------------------------------------
  if (verifyState === "not-found") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Dashboard Not Found</CardTitle>
            <CardDescription>
              This analytics dashboard does not exist or has been disabled.
              Please check the URL and try again.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: Password form
  // -------------------------------------------------------------------------
  if (verifyState === "password-required") {
    return (
      <PasswordForm
        onSubmit={handlePasswordSubmit}
        isLoading={authLoading}
        error={authError}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Render: Dashboard
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-muted-foreground" />
              <div>
                <h1 className="text-lg font-semibold">
                  {dashboardInfo?.domainHostname ?? "Analytics"}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-[130px]">
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleExportCsv}>
                    Export CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportJson}>
                    Export JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {dataError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{dataError}</AlertDescription>
          </Alert>
        )}

        {/* Summary cards */}
        <SummaryCards summary={summaryData} isLoading={dataLoading && !summaryData} />

        {/* Tabbed sections */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="pages">Pages</TabsTrigger>
            <TabsTrigger value="referrers">Referrers</TabsTrigger>
            <TabsTrigger value="geography">Geography</TabsTrigger>
            <TabsTrigger value="devices">Devices</TabsTrigger>
            <TabsTrigger value="utm">Campaigns</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <TimeseriesSection
              data={timeseriesData}
              isLoading={dataLoading && !timeseriesData}
            />

            <div className="grid gap-6 lg:grid-cols-2">
              <PagesSection data={pagesData} isLoading={dataLoading && !pagesData} />
              <ReferrersSection data={referrersData} isLoading={dataLoading && !referrersData} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <GeographySection data={geographyData} isLoading={dataLoading && !geographyData} />
              <DevicesSection data={devicesData} isLoading={dataLoading && !devicesData} />
            </div>
          </TabsContent>

          <TabsContent value="pages" className="space-y-6">
            <PagesSection data={pagesData} isLoading={dataLoading && !pagesData} />

            {pagesData && (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Entry Pages</CardTitle>
                    <CardDescription>Where visitors begin their session</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {pagesData.entryPages.length > 0 ? (
                      <div className="space-y-2">
                        {pagesData.entryPages.slice(0, 10).map((page) => (
                          <div
                            key={page.pathname}
                            className="flex items-center justify-between"
                          >
                            <span className="text-sm truncate max-w-[60%]">
                              {page.pathname}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {formatNumber(page.visitors)} visitors
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
                    <CardTitle className="text-base">Exit Pages</CardTitle>
                    <CardDescription>Where visitors leave</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {pagesData.exitPages.length > 0 ? (
                      <div className="space-y-2">
                        {pagesData.exitPages.slice(0, 10).map((page) => (
                          <div
                            key={page.pathname}
                            className="flex items-center justify-between"
                          >
                            <span className="text-sm truncate max-w-[60%]">
                              {page.pathname}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {formatNumber(page.visitors)} visitors
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No data available</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="referrers">
            <ReferrersSection data={referrersData} isLoading={dataLoading && !referrersData} />
          </TabsContent>

          <TabsContent value="geography">
            <GeographySection data={geographyData} isLoading={dataLoading && !geographyData} />
          </TabsContent>

          <TabsContent value="devices">
            <DevicesSection data={devicesData} isLoading={dataLoading && !devicesData} />
          </TabsContent>

          <TabsContent value="utm">
            <UTMSection data={utmData} isLoading={dataLoading && !utmData} />
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="border-t pt-4 pb-8">
          <p className="text-xs text-center text-muted-foreground">
            Analytics for {dashboardInfo?.domainHostname ?? "this site"} --
            Powered by Uni-Proxy-Manager
          </p>
        </div>
      </main>
    </div>
  );
}
