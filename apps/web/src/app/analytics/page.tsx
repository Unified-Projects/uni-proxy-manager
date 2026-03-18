"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import {
  BarChart3,
  Plus,
  AlertCircle,
  Globe,
  Eye,
  Users,
  MousePointerClick,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Alert,
  AlertDescription,
  AlertTitle,
  Skeleton,
  Badge,
  DataTable,
  DataTableColumnHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@uni-proxy-manager/ui";
import { useAnalyticsExtensionEnabled } from "@/hooks";
import { useAnalyticsConfigs, useEnableAnalytics } from "@/hooks/use-analytics";
import { useAnalyticsTimeseries } from "@/hooks/use-analytics-data";
import { useDomains } from "@/hooks/use-domains";
import type { AnalyticsConfig, AnalyticsTimeseriesBucket } from "@/lib/types";

// ---------------------------------------------------------------------------
// Enable Analytics Dialog
// ---------------------------------------------------------------------------

interface EnableAnalyticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function EnableAnalyticsDialog({ open, onOpenChange }: EnableAnalyticsDialogProps) {
  const { toast } = useToast();
  const [selectedDomainId, setSelectedDomainId] = useState<string>("");
  const { data: domains } = useDomains();
  const { data: configs } = useAnalyticsConfigs();
  const enableAnalytics = useEnableAnalytics();

  // Filter out domains that already have analytics enabled
  const enabledDomainIds = new Set(configs?.map((c) => c.domainId) ?? []);
  const availableDomains = domains?.filter((d) => !enabledDomainIds.has(d.id)) ?? [];

  const handleEnable = async () => {
    if (!selectedDomainId) {
      toast({
        title: "Error",
        description: "Please select a domain to enable analytics on.",
        variant: "destructive",
      });
      return;
    }

    try {
      await enableAnalytics.mutateAsync({ domainId: selectedDomainId });
      toast({
        title: "Analytics enabled",
        description: "Analytics tracking has been enabled for this domain.",
      });
      setSelectedDomainId("");
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to enable analytics",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Enable Analytics</DialogTitle>
          <DialogDescription>
            Select a domain to enable privacy-first analytics tracking on. You
            can configure advanced settings after enabling.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Domain</label>
            <Select value={selectedDomainId} onValueChange={setSelectedDomainId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a domain" />
              </SelectTrigger>
              <SelectContent>
                {availableDomains.length > 0 ? (
                  availableDomains.map((domain) => (
                    <SelectItem key={domain.id} value={domain.id}>
                      {domain.hostname}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>
                    No domains available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only domains without analytics enabled are shown.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleEnable}
            disabled={enableAnalytics.isPending || !selectedDomainId}
          >
            {enableAnalytics.isPending ? "Enabling..." : "Enable Analytics"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sparkline - inline SVG chart showing the last 7 days of page views
// ---------------------------------------------------------------------------

function Sparkline({ configId }: { configId: string }) {
  // Fetch the last 7 days of timeseries data for this config.
  const params = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }, []);

  const { data: timeseries, isLoading } = useAnalyticsTimeseries(configId, params);

  if (isLoading) {
    return <Skeleton className="h-6 w-24" />;
  }

  const buckets: AnalyticsTimeseriesBucket[] = timeseries ?? [];
  if (buckets.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">No data</span>
    );
  }

  const values = buckets.map((b) => b.pageViews);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const width = 100;
  const height = 28;
  const padding = 2;

  // Build an SVG polyline from the values.
  const points = values
    .map((v, i) => {
      const x = padding + (i / Math.max(values.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  // Also build an area fill polygon.
  const areaPoints =
    `${padding},${height - padding} ` +
    points +
    ` ${padding + ((values.length - 1) / Math.max(values.length - 1, 1)) * (width - padding * 2)},${height - padding}`;

  const total = values.reduce((sum, v) => sum + v, 0);

  return (
    <div className="flex items-center gap-2">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0"
      >
        <polygon
          points={areaPoints}
          fill="hsl(var(--primary) / 0.15)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-xs text-muted-foreground tabular-nums">
        {total.toLocaleString()}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics Configs Table
// ---------------------------------------------------------------------------

interface AnalyticsTableProps {
  configs: AnalyticsConfig[];
  isLoading: boolean;
}

function AnalyticsTable({ configs, isLoading }: AnalyticsTableProps) {
  const columns: ColumnDef<AnalyticsConfig>[] = [
    {
      accessorKey: "domainHostname",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Domain" />
      ),
      cell: ({ row }) => {
        const config = row.original;
        return (
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <Link
              href={`/analytics/${config.id}`}
              className="font-medium hover:underline"
            >
              {config.domainHostname}
            </Link>
          </div>
        );
      },
    },
    {
      accessorKey: "enabled",
      header: "Status",
      cell: ({ row }) => {
        const enabled = row.getValue("enabled") as boolean;
        return (
          <Badge
            className={
              enabled
                ? "bg-green-500/10 text-green-500"
                : "bg-muted text-muted-foreground"
            }
          >
            {enabled ? "Active" : "Disabled"}
          </Badge>
        );
      },
    },
    {
      id: "sparkline",
      header: "Last 7 Days",
      cell: ({ row }) => {
        const config = row.original;
        if (!config.enabled) {
          return (
            <span className="text-xs text-muted-foreground">--</span>
          );
        }
        return <Sparkline configId={config.id} />;
      },
    },
    {
      accessorKey: "trackScrollDepth",
      header: "Tracking",
      cell: ({ row }) => {
        const config = row.original;
        const features: string[] = [];
        if (config.trackScrollDepth) features.push("Scroll");
        if (config.trackSessionDuration) features.push("Sessions");
        if (config.trackOutboundLinks) features.push("Outbound");
        return (
          <span className="text-sm text-muted-foreground">
            {features.length > 0 ? features.join(", ") : "Basic"}
          </span>
        );
      },
    },
    {
      accessorKey: "publicDashboardEnabled",
      header: "Public Dashboard",
      cell: ({ row }) => {
        const config = row.original;
        return (
          <div className="flex items-center gap-1">
            <Eye
              className={`h-4 w-4 ${
                config.publicDashboardEnabled
                  ? "text-green-500"
                  : "text-muted-foreground"
              }`}
            />
            <span className="text-sm">
              {config.publicDashboardEnabled ? "Enabled" : "Off"}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "rawRetentionDays",
      header: "Retention",
      cell: ({ row }) => {
        const config = row.original;
        return (
          <span className="text-sm text-muted-foreground">
            {config.rawRetentionDays}d raw / {config.aggregateRetentionDays}d
            aggregate
          </span>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const config = row.original;
        return (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/analytics/${config.id}`}>
              <BarChart3 className="mr-2 h-4 w-4" />
              View Dashboard
            </Link>
          </Button>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={configs}
      isLoading={isLoading}
      searchKey="domainHostname"
      searchPlaceholder="Search by domain..."
      emptyMessage="No analytics configurations found. Enable analytics on a domain to get started."
    />
  );
}

// ---------------------------------------------------------------------------
// Summary Cards
// ---------------------------------------------------------------------------

interface SummaryCardsProps {
  configs: AnalyticsConfig[];
}

function SummaryCards({ configs }: SummaryCardsProps) {
  const totalConfigs = configs.length;
  const activeConfigs = configs.filter((c) => c.enabled).length;
  const publicDashboards = configs.filter((c) => c.publicDashboardEnabled).length;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Total Configurations
          </CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalConfigs}</div>
          <p className="text-xs text-muted-foreground">
            domain{totalConfigs !== 1 ? "s" : ""} with analytics
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Active Tracking
          </CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activeConfigs}</div>
          <p className="text-xs text-muted-foreground">
            domain{activeConfigs !== 1 ? "s" : ""} actively collecting data
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Public Dashboards
          </CardTitle>
          <MousePointerClick className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{publicDashboards}</div>
          <p className="text-xs text-muted-foreground">
            publicly accessible dashboard{publicDashboards !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [enableDialogOpen, setEnableDialogOpen] = useState(false);
  const { enabled: analyticsEnabled, isLoading: extensionLoading } =
    useAnalyticsExtensionEnabled();
  const { data: configs, isLoading } = useAnalyticsConfigs();

  // Extension loading state
  if (extensionLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-5 w-96" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Extension not enabled
  if (!analyticsEnabled) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">
            Privacy-first web analytics for your domains.
          </p>
        </div>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Analytics Extension Not Enabled</AlertTitle>
          <AlertDescription>
            The Analytics extension is not enabled. To enable it, include the
            docker-compose.analytics.yml overlay in your deployment and set the
            UNI_PROXY_MANAGER_ANALYTICS_ENDPOINT environment variable.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">
            Privacy-first web analytics for your domains.
          </p>
        </div>
        <Button onClick={() => setEnableDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Enable Analytics
        </Button>
      </div>

      {configs && configs.length > 0 && <SummaryCards configs={configs} />}

      <Card>
        <CardHeader>
          <CardTitle>Analytics Configurations</CardTitle>
          <CardDescription>
            {configs?.length ?? 0} domain{(configs?.length ?? 0) !== 1 ? "s" : ""}{" "}
            with analytics configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnalyticsTable configs={configs ?? []} isLoading={isLoading} />
        </CardContent>
      </Card>

      <EnableAnalyticsDialog
        open={enableDialogOpen}
        onOpenChange={setEnableDialogOpen}
      />
    </div>
  );
}
