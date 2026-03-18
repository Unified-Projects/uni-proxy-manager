"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe, Shield, Wrench, Server, Pencil, Trash2, Plus, BarChart3, Route, Ban, Lock, Bug } from "lucide-react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Skeleton,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@uni-proxy-manager/ui";
import { useDomain, useUpdateDomain } from "@/hooks/use-domains";
import { useBackends } from "@/hooks/use-backends";
import { useEnableMaintenance, useDisableMaintenance } from "@/hooks/use-maintenance";
import { useErrorPages } from "@/hooks/use-error-pages";
import { useMaintenancePages } from "@/hooks/use-maintenance-pages";
import { BackendsTable } from "./_components/backends-table";
import { CreateBackendDialog } from "./_components/create-backend-dialog";
import { EditDomainDialog } from "./_components/edit-domain-dialog";
import { DeleteDomainDialog } from "../_components/delete-domain-dialog";
import { DomainAnalytics } from "./_components/domain-analytics";
import { DomainRouteRules } from "./_components/domain-route-rules";
import { DomainAccessControl } from "./_components/domain-access-control";
import { DomainSecurityHeaders } from "./_components/domain-security-headers";
import { DomainBlockedRoutes } from "./_components/domain-blocked-routes";
import { DomainBotProtection } from "./_components/domain-bot-protection";
import { getStatusLabel, getStatusColorClass } from "@/lib/domain-status";

interface DomainDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function DomainDetailPage({ params }: DomainDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [createBackendDialogOpen, setCreateBackendDialogOpen] = useState(false);

  const { data: domain, isLoading } = useDomain(id);
  const { data: backends, isLoading: backendsLoading } = useBackends(id);
  const { data: errorPages } = useErrorPages();
  const { data: maintenancePages } = useMaintenancePages();
  const updateDomain = useUpdateDomain();
  const enableMaintenance = useEnableMaintenance();
  const disableMaintenance = useDisableMaintenance();

  // Filter error pages to only show 503/5xx types and custom pages
  const availableErrorPages = errorPages?.filter(p => p.type !== "maintenance") ?? [];
  // Filter to only show maintenance type pages
  const availableMaintenancePages = maintenancePages ?? [];

  const handleMaintenanceToggle = async (enabled: boolean) => {
    if (!domain) return;

    try {
      if (enabled) {
        await enableMaintenance.mutateAsync({ domainId: domain.id });
        toast({
          title: "Maintenance enabled",
          description: `${domain.hostname} is now in maintenance mode.`,
        });
      } else {
        await disableMaintenance.mutateAsync(domain.id);
        toast({
          title: "Maintenance disabled",
          description: `${domain.hostname} is back online.`,
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to toggle maintenance",
        variant: "destructive",
      });
    }
  };

  const handleSslToggle = async (enabled: boolean) => {
    if (!domain) return;

    try {
      await updateDomain.mutateAsync({
        id: domain.id,
        data: { sslEnabled: enabled },
      });
      toast({
        title: enabled ? "SSL enabled" : "SSL disabled",
        description: `SSL has been ${enabled ? "enabled" : "disabled"} for ${domain.hostname}.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update SSL",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (!domain) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-2xl font-bold">Domain not found</h2>
        <p className="text-muted-foreground">
          The domain you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button asChild className="mt-4">
          <Link href="/domains">Back to Domains</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/domains">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Globe className="h-6 w-6" />
              <h1 className="text-3xl font-bold">{domain.hostname}</h1>
              <Badge className={getStatusColorClass(domain.statusComputed || "no-backends")}>
                {getStatusLabel(domain.statusComputed || "no-backends")}
              </Badge>
            </div>
            {domain.displayName && (
              <p className="text-muted-foreground">{domain.displayName}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditDialogOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">SSL</CardTitle>
            <Shield className={`h-4 w-4 ${domain.sslEnabled ? "text-green-500" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">
                {domain.sslEnabled ? "Enabled" : "Disabled"}
              </span>
              <Switch
                checked={domain.sslEnabled}
                onCheckedChange={handleSslToggle}
                disabled={updateDomain.isPending}
              />
            </div>
            {domain.forceHttps && domain.sslEnabled && (
              <p className="text-xs text-muted-foreground mt-1">Force HTTPS enabled</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Maintenance</CardTitle>
            <Wrench className={`h-4 w-4 ${domain.maintenanceEnabled ? "text-yellow-500" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">
                {domain.maintenanceEnabled ? "Active" : "Off"}
              </span>
              <Switch
                checked={domain.maintenanceEnabled}
                onCheckedChange={handleMaintenanceToggle}
                disabled={enableMaintenance.isPending || disableMaintenance.isPending}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Backends</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {backends?.filter(b => b.enabled).length ?? 0} active
            </div>
            <p className="text-xs text-muted-foreground">
              {backends?.filter(b => b.enabled && b.isHealthy).length ?? 0} healthy / {backends?.length ?? 0} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Config Version</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">v{domain.configVersion}</div>
            {domain.lastConfigUpdate && (
              <p className="text-xs text-muted-foreground">
                Updated {new Date(domain.lastConfigUpdate).toLocaleDateString()}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="backends" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="backends">Backends</TabsTrigger>
          <TabsTrigger value="routing">
            <Route className="mr-2 h-4 w-4" />
            Routing
          </TabsTrigger>
          <TabsTrigger value="access">
            <Lock className="mr-2 h-4 w-4" />
            Access Control
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="mr-2 h-4 w-4" />
            Security Headers
          </TabsTrigger>
          <TabsTrigger value="blocked">
            <Ban className="mr-2 h-4 w-4" />
            Blocked Routes
          </TabsTrigger>
          <TabsTrigger value="bot-protection">
            <Bug className="mr-2 h-4 w-4" />
            Bot Protection
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="mr-2 h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="backends" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Backend Servers</CardTitle>
                <CardDescription>
                  Configure the backend servers for this domain
                </CardDescription>
              </div>
              <Button onClick={() => setCreateBackendDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Backend
              </Button>
            </CardHeader>
            <CardContent>
              <BackendsTable
                backends={backends ?? []}
                isLoading={backendsLoading}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="routing" className="space-y-4">
          <DomainRouteRules domainId={id} />
        </TabsContent>

        <TabsContent value="access" className="space-y-4">
          <DomainAccessControl domainId={id} />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <DomainSecurityHeaders domainId={id} />
        </TabsContent>

        <TabsContent value="blocked" className="space-y-4">
          <DomainBlockedRoutes domainId={id} />
        </TabsContent>

        <TabsContent value="bot-protection" className="space-y-4">
          <DomainBotProtection domainId={id} />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <DomainAnalytics domainId={id} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Domain Settings</CardTitle>
              <CardDescription>
                Configure SSL, HTTPS, and error pages
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="font-medium">Force HTTPS</p>
                    <p className="text-sm text-muted-foreground">
                      Redirect all HTTP traffic to HTTPS
                    </p>
                  </div>
                  <Switch
                    checked={domain.forceHttps}
                    onCheckedChange={(checked) =>
                      updateDomain.mutate({
                        id: domain.id,
                        data: { forceHttps: checked },
                      })
                    }
                    disabled={updateDomain.isPending}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex-1 mr-4">
                    <p className="font-medium">Error Page</p>
                    <p className="text-sm text-muted-foreground">
                      Shown when backend is unavailable (503)
                    </p>
                  </div>
                  <Select
                    value={domain.errorPageId || "default"}
                    onValueChange={(value) => {
                      updateDomain.mutate({
                        id: domain.id,
                        data: { errorPageId: value === "default" ? null : value },
                      });
                    }}
                    disabled={updateDomain.isPending}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select error page" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default (None)</SelectItem>
                      {availableErrorPages.map((page) => (
                        <SelectItem key={page.id} value={page.id}>
                          {page.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex-1 mr-4">
                    <p className="font-medium">Maintenance Page</p>
                    <p className="text-sm text-muted-foreground">
                      Shown when maintenance mode is enabled
                    </p>
                  </div>
                  <Select
                    value={domain.maintenancePageId || "default"}
                    onValueChange={(value) => {
                      updateDomain.mutate({
                        id: domain.id,
                        data: { maintenancePageId: value === "default" ? null : value },
                      });
                    }}
                    disabled={updateDomain.isPending}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select maintenance page" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default (None)</SelectItem>
                      {availableMaintenancePages.map((page) => (
                        <SelectItem key={page.id} value={page.id}>
                          {page.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="font-medium">Bypass IPs</p>
                    <p className="text-sm text-muted-foreground">
                      {domain.maintenanceBypassIps.length} IP(s) configured
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/maintenance">Manage</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EditDomainDialog
        domain={domain}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <DeleteDomainDialog
        domain={domain}
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            router.push("/domains");
          }
        }}
      />

      <CreateBackendDialog
        domainId={domain.id}
        open={createBackendDialogOpen}
        onOpenChange={setCreateBackendDialogOpen}
      />
    </div>
  );
}
