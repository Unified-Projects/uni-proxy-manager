"use client";

import { useState, useMemo } from "react";
import * as Diff from "diff";
import { Activity, AlertCircle, RefreshCw, Copy, Check, FileText, Eye, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  ScrollArea,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@uni-proxy-manager/ui";
import { useHaproxyStatus, useHaproxyReload, useHaproxyConfig, useHaproxyConfigPreview, useHaproxyConfigDiff } from "@/hooks/use-haproxy";
import { useHaproxyWatchdogConfig, useUpdateHaproxyWatchdogConfig } from "@/hooks/use-system-config";

export function HaproxySettings() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const { data: status, isLoading, error, refetch } = useHaproxyStatus();
  const reloadHaproxy = useHaproxyReload();
  const { data: config, isLoading: configLoading, refetch: refetchConfig } = useHaproxyConfig();
  const { data: preview, isLoading: previewLoading, refetch: refetchPreview } = useHaproxyConfigPreview();
  const { data: configDiff, refetch: refetchDiff } = useHaproxyConfigDiff();

  const handleReload = async (force: boolean = false) => {
    try {
      const result = await reloadHaproxy.mutateAsync(force);

      if (result.success) {
        toast({
          title: result.changed ? "HAProxy reloaded" : "No changes",
          description: result.message ?? (result.changed
            ? "HAProxy configuration has been reloaded successfully."
            : "Configuration is already up to date."),
        });
      } else {
        toast({
          title: "Reload failed",
          description: result.message ?? "Failed to reload HAProxy configuration.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to reload HAProxy",
        variant: "destructive",
      });
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({
        title: "Copied",
        description: "Configuration copied to clipboard.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  const handleRefreshConfig = () => {
    refetchConfig();
    refetchPreview();
    refetchDiff();
  };

  const { data: watchdogConfig, isLoading: watchdogLoading } = useHaproxyWatchdogConfig();
  const updateWatchdog = useUpdateHaproxyWatchdogConfig();

  const handleWatchdogToggle = async (enabled: boolean) => {
    try {
      await updateWatchdog.mutateAsync({ enabled });
      toast({
        title: enabled ? "Watchdog enabled" : "Watchdog disabled",
        description: enabled
          ? "HAProxy will be automatically restarted if it becomes unhealthy."
          : "Automatic HAProxy recovery has been disabled.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update watchdog config",
        variant: "destructive",
      });
    }
  };

  const hasPendingChanges = configDiff?.hasPendingChanges ?? false;

  const unifiedDiff = useMemo(() => {
    if (!preview) return null;
    const oldText = (config as string) ?? "";
    const newText = preview as string;
    return Diff.createPatch("haproxy.cfg", oldText, newText, "current", "preview");
  }, [config, preview]);

  const getStatusBadge = () => {
    if (!status) return null;

    switch (status.status) {
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
        return (
          <Badge className="bg-gray-500/10 text-gray-500">
            Unknown
          </Badge>
        );
    }
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>HAProxy Status</CardTitle>
          <CardDescription>
            Unable to connect to HAProxy service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>
              {error instanceof Error ? error.message : "Failed to fetch status"}
            </span>
          </div>
          <Button className="mt-4" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>HAProxy Status</CardTitle>
              <CardDescription>
                Current status of the HAProxy load balancer service.
              </CardDescription>
            </div>
            {!isLoading && getStatusBadge()}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-4 w-[150px]" />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-muted p-2">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Current Connections</p>
                  <p className="font-medium">{status?.currentConnections ?? 0}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="rounded-md bg-muted p-2">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Config Status</p>
                  <p className="font-medium">
                    {status?.configExists ? "Present" : "Missing"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions Card */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration Actions</CardTitle>
          <CardDescription>
            Reload HAProxy to apply configuration changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button
              onClick={() => handleReload(false)}
              disabled={reloadHaproxy.isPending}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${reloadHaproxy.isPending ? "animate-spin" : ""}`}
              />
              {reloadHaproxy.isPending ? "Reloading..." : "Reload Configuration"}
            </Button>

            <Button
              variant="outline"
              onClick={() => handleReload(true)}
              disabled={reloadHaproxy.isPending}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${reloadHaproxy.isPending ? "animate-spin" : ""}`}
              />
              Force Reload
            </Button>

            <Button variant="ghost" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Status
            </Button>
          </div>

          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h4 className="font-medium mb-2">Reload vs Force Reload</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>
                <strong>Reload:</strong> Gracefully reloads configuration if there are changes.
                Existing connections are preserved.
              </li>
              <li>
                <strong>Force Reload:</strong> Forces a configuration reload even if no changes
                are detected. May briefly interrupt connections.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Watchdog Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Auto-Recovery Watchdog</CardTitle>
              <CardDescription>
                Automatically restart HAProxy when it becomes unhealthy.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {watchdogLoading ? (
            <Skeleton className="h-6 w-[200px]" />
          ) : (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="watchdog-toggle" className="text-base font-medium">
                  Enable Watchdog
                </Label>
                <p className="text-sm text-muted-foreground">
                  Periodically checks HAProxy health and restarts the container if it is unresponsive.
                </p>
              </div>
              <Switch
                id="watchdog-toggle"
                checked={watchdogConfig?.enabled ?? true}
                onCheckedChange={handleWatchdogToggle}
                disabled={updateWatchdog.isPending}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configuration Viewer Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>HAProxy Configuration</CardTitle>
              <CardDescription>
                View the current and preview configuration for HAProxy.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleRefreshConfig}>
              <RefreshCw className={`mr-2 h-4 w-4 ${(configLoading || previewLoading) ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="current" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="current">
                <FileText className="mr-2 h-4 w-4" />
                Current Config
              </TabsTrigger>
              <TabsTrigger value="preview">
                <Eye className="mr-2 h-4 w-4" />
                Preview {hasPendingChanges && "(Pending)"}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="current">
              {configLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-[90%]" />
                  <Skeleton className="h-4 w-[85%]" />
                  <Skeleton className="h-4 w-[95%]" />
                  <Skeleton className="h-4 w-[80%]" />
                </div>
              ) : config ? (
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-2 z-10"
                    onClick={() => handleCopy(config as string)}
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <ScrollArea className="h-[500px] w-full rounded-md border bg-muted/50 p-4">
                    <pre className="text-sm font-mono whitespace-pre">
                      {config as string}
                    </pre>
                  </ScrollArea>
                </div>
              ) : (
                <div className="rounded-md border p-6 text-center text-muted-foreground">
                  No configuration file found. Configuration will be generated when you add domains.
                </div>
              )}
            </TabsContent>

            <TabsContent value="preview">
              {previewLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-[90%]" />
                  <Skeleton className="h-4 w-[85%]" />
                  <Skeleton className="h-4 w-[95%]" />
                  <Skeleton className="h-4 w-[80%]" />
                </div>
              ) : !hasPendingChanges && preview ? (
                <div className="rounded-md border p-6 text-center text-muted-foreground">
                  No changes pending. The proposed configuration matches the current configuration.
                </div>
              ) : preview && unifiedDiff ? (
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-2 z-10"
                    onClick={() => handleCopy(preview as string)}
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <ScrollArea className="h-[500px] w-full rounded-md border bg-muted/30 p-0">
                    <pre className="text-sm font-mono whitespace-pre">
                      {unifiedDiff.split("\n").map((line, i) => {
                        let className = "block px-4 text-muted-foreground";
                        if (line.startsWith("+++") || line.startsWith("---")) {
                          className = "block px-4 text-muted-foreground font-semibold";
                        } else if (line.startsWith("@@")) {
                          className = "block px-4 bg-blue-500/10 text-blue-400";
                        } else if (line.startsWith("+")) {
                          className = "block px-4 bg-green-500/10 text-green-400";
                        } else if (line.startsWith("-")) {
                          className = "block px-4 bg-red-500/10 text-red-400";
                        }
                        return (
                          <span key={i} className={className}>
                            {line || "\u00a0"}
                          </span>
                        );
                      })}
                    </pre>
                  </ScrollArea>
                </div>
              ) : (
                <div className="rounded-md border p-6 text-center text-muted-foreground">
                  No configuration file found. Configuration will be generated when you add domains.
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
