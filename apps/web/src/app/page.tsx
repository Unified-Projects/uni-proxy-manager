"use client";

import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@uni-proxy-manager/ui";
import {
  Globe,
  Shield,
  Server,
  Wrench,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Activity,
  ArrowRight,
} from "lucide-react";
import { useDashboardStats } from "@/hooks/use-stats";
import { useHaproxyStatus } from "@/hooks/use-haproxy";
import { useCertificates } from "@/hooks/use-certificates";
import { useDomains } from "@/hooks/use-domains";
import { useMaintenanceWindows } from "@/hooks/use-maintenance";
import { useDashboardMetrics } from "@/hooks/use-metrics";
import { TrafficChart } from "@/components/metrics/traffic-chart";
import { getStatusColorClass, getStatusLabel } from "@/lib/domain-status";
import type { ComputedDomainStatus } from "@/lib/types";
import { format } from "date-fns";

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useDashboardStats();
  const { data: haproxyStatus, isLoading: haproxyLoading } = useHaproxyStatus();
  const { data: certificates } = useCertificates();
  const { data: domains } = useDomains();
  const { data: maintenanceWindows } = useMaintenanceWindows({ active: true });
  const { data: metrics } = useDashboardMetrics();

  // Find certificates expiring soon (within 30 days)
  const expiringCerts = certificates?.filter((cert) => {
    if (!cert.expiresAt || cert.status !== "active") return false;
    const daysUntilExpiry = Math.floor(
      (new Date(cert.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return daysUntilExpiry <= 30 && daysUntilExpiry > 0;
  }) ?? [];

  // Find domains with issues
  const issueStatuses: ComputedDomainStatus[] = [
    "degraded",
    "offline",
    "ssl-error",
    "ssl-expired",
    "ssl-pending",
    "no-backends",
  ];
  const domainsWithIssues = domains?.filter((d) =>
    issueStatuses.includes(d.statusComputed ?? "no-backends")
  ) ?? [];
  const activeDomainCount = domains?.filter(
    (d) => (d.statusComputed ?? "no-backends") === "active"
  ).length ?? stats?.domains.active ?? 0;

  const getHaproxyStatusBadge = () => {
    if (haproxyLoading) return <Skeleton className="h-5 w-16" />;
    if (!haproxyStatus) return <Badge variant="secondary">Unknown</Badge>;

    switch (haproxyStatus.status) {
      case "running":
        return (
          <Badge className="bg-green-500/10 text-green-500">
            <Activity className="mr-1 h-3 w-3" />
            Running
          </Badge>
        );
      case "stopped":
        return (
          <Badge className="bg-red-500/10 text-red-500">
            <AlertCircle className="mr-1 h-3 w-3" />
            Stopped
          </Badge>
        );
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Manage your HAProxy configuration, SSL certificates, and domains.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {getHaproxyStatusBadge()}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Domains</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.domains.total ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  {activeDomainCount} active, {domainsWithIssues.length} need attention
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Certificates</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.certificates.total ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  {stats?.certificates.active ?? 0} active, {stats?.certificates.pending ?? 0} pending
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Backends</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.backends.total ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  <span className="text-green-500">{stats?.backends.healthy ?? 0} healthy</span>
                  {(stats?.backends.unhealthy ?? 0) > 0 && (
                    <span className="text-red-500 ml-1">
                      , {stats?.backends.unhealthy} unhealthy
                    </span>
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Maintenance</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {stats?.maintenance.domainsInMaintenance ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  {stats?.maintenance.scheduledWindows ?? 0} scheduled windows
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Traffic Chart */}
      <TrafficChart
        data={[...(metrics?.recentTraffic ?? [])].reverse()}
        title="Traffic (Last 24 Hours)"
        uniqueVisitorsTotal={metrics?.uniqueVisitorsToday}
      />

      {/* Alert Cards */}
      {(expiringCerts.length > 0 || domainsWithIssues.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {expiringCerts.length > 0 && (
            <Card className="border-yellow-500/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-500" />
                  <CardTitle className="text-lg">Expiring Certificates</CardTitle>
                </div>
                <CardDescription>
                  {expiringCerts.length} certificate{expiringCerts.length !== 1 ? "s" : ""} expiring within 30 days
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {expiringCerts.slice(0, 3).map((cert) => {
                    const daysLeft = Math.floor(
                      (new Date(cert.expiresAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                    );
                    return (
                      <div
                        key={cert.id}
                        className="flex items-center justify-between rounded-lg border p-2"
                      >
                        <span className="font-medium text-sm">{cert.commonName}</span>
                        <Badge className="bg-yellow-500/10 text-yellow-500">
                          {daysLeft} days left
                        </Badge>
                      </div>
                    );
                  })}
                  {expiringCerts.length > 3 && (
                    <Link href="/certificates">
                      <Button variant="ghost" size="sm" className="w-full">
                        View all {expiringCerts.length} certificates
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {domainsWithIssues.length > 0 && (
            <Card className="border-red-500/50">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <CardTitle className="text-lg">Domain Issues</CardTitle>
                </div>
                <CardDescription>
                  {domainsWithIssues.length} domain{domainsWithIssues.length !== 1 ? "s" : ""} need attention
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {domainsWithIssues.slice(0, 3).map((domain) => (
                    <div
                      key={domain.id}
                      className="flex items-center justify-between rounded-lg border p-2"
                    >
                      <span className="font-medium text-sm">{domain.hostname}</span>
                      <Badge className={getStatusColorClass(domain.statusComputed || "no-backends")}>
                        {getStatusLabel(domain.statusComputed || "no-backends")}
                      </Badge>
                    </div>
                  ))}
                  {domainsWithIssues.length > 3 && (
                    <Link href="/domains">
                      <Button variant="ghost" size="sm" className="w-full">
                        View all {domainsWithIssues.length} domains
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Active Maintenance Windows */}
      {maintenanceWindows && maintenanceWindows.length > 0 && (
        <Card className="border-yellow-500/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-yellow-500" />
              <CardTitle>Active Maintenance</CardTitle>
            </div>
            <CardDescription>
              Currently active maintenance windows
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {maintenanceWindows.map((window) => (
                <div
                  key={window.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{window.domain?.hostname ?? "Unknown Domain"}</p>
                    {window.title && (
                      <p className="text-sm text-muted-foreground">{window.title}</p>
                    )}
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    {window.activatedAt && (
                      <p>Started {format(new Date(window.activatedAt), "MMM d, HH:mm")}</p>
                    )}
                    {window.scheduledEndAt && (
                      <p>Ends {format(new Date(window.scheduledEndAt), "MMM d, HH:mm")}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions and HAProxy Status */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common management tasks</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Link href="/domains" className="block">
              <Button variant="outline" className="w-full justify-start">
                <Plus className="mr-2 h-4 w-4" />
                Add New Domain
              </Button>
            </Link>
            <Link href="/certificates" className="block">
              <Button variant="outline" className="w-full justify-start">
                <Shield className="mr-2 h-4 w-4" />
                Request Certificate
              </Button>
            </Link>
            <Link href="/dns-providers" className="block">
              <Button variant="outline" className="w-full justify-start">
                <Server className="mr-2 h-4 w-4" />
                Configure DNS Provider
              </Button>
            </Link>
            <Link href="/maintenance" className="block">
              <Button variant="outline" className="w-full justify-start">
                <Wrench className="mr-2 h-4 w-4" />
                Manage Maintenance
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>HAProxy Status</CardTitle>
            <CardDescription>Current load balancer status</CardDescription>
          </CardHeader>
          <CardContent>
            {haproxyLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-[200px]" />
                <Skeleton className="h-4 w-[150px]" />
                <Skeleton className="h-4 w-[180px]" />
              </div>
            ) : haproxyStatus ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {haproxyStatus.status === "running" ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  )}
                  <div>
                    <p className="font-medium">
                      {haproxyStatus.status === "running" ? "Operational" : "Not Running"}
                    </p>
                    {haproxyStatus.uptime && (
                      <p className="text-sm text-muted-foreground">
                        Uptime: {haproxyStatus.uptime}
                      </p>
                    )}
                  </div>
                </div>
                <Link href="/settings">
                  <Button variant="outline" size="sm">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Manage HAProxy
                  </Button>
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Unable to retrieve HAProxy status.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
