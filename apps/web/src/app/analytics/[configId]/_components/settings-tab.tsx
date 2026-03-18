"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Settings,
  Copy,
  RefreshCw,
  Key,
  Code,
  Database,
  MousePointerClick,
  Shield,
  Eye,
  Check,
  Lock,
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
  Switch,
  Textarea,
  Separator,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  useToast,
} from "@uni-proxy-manager/ui";
import {
  useUpdateAnalyticsConfig,
  useRegenerateTrackingUuid,
  useRegenerateApiToken,
  useRotatePublicDashboardToken,
} from "@/hooks/use-analytics";
import { usePomeriumExtensionEnabled } from "@/hooks/use-extensions";
import type { AnalyticsConfig, UpdateAnalyticsConfigData } from "@/lib/types";

interface SettingsTabProps {
  config: AnalyticsConfig | undefined;
}

export function SettingsTab({ config }: SettingsTabProps) {
  const { toast } = useToast();
  const updateConfig = useUpdateAnalyticsConfig();
  const regenerateUuid = useRegenerateTrackingUuid();
  const regenerateApiToken = useRegenerateApiToken();
  const rotatePublicToken = useRotatePublicDashboardToken();
  const { enabled: pomeriumEnabled } = usePomeriumExtensionEnabled();

  // ---------- Local form state ----------

  const [rawRetentionDays, setRawRetentionDays] = useState<number>(
    config?.rawRetentionDays ?? 90
  );
  const [aggregateRetentionDays, setAggregateRetentionDays] = useState<number>(
    config?.aggregateRetentionDays ?? 730
  );
  const [trackScrollDepth, setTrackScrollDepth] = useState(
    config?.trackScrollDepth ?? false
  );
  const [trackSessionDuration, setTrackSessionDuration] = useState(
    config?.trackSessionDuration ?? true
  );
  const [trackOutboundLinks, setTrackOutboundLinks] = useState(
    config?.trackOutboundLinks ?? false
  );
  const [allowedOrigins, setAllowedOrigins] = useState(
    config?.allowedOrigins?.join("\n") ?? ""
  );
  const [ignoredPaths, setIgnoredPaths] = useState(
    config?.ignoredPaths?.join("\n") ?? ""
  );
  const [publicDashboardEnabled, setPublicDashboardEnabled] = useState(
    config?.publicDashboardEnabled ?? false
  );

  const [publicDashboardPassword, setPublicDashboardPassword] = useState("");

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [generatedApiToken, setGeneratedApiToken] = useState<string | null>(null);

  // Sync local state when config changes (e.g. after mutation invalidation)
  useEffect(() => {
    if (!config) return;
    setRawRetentionDays(config.rawRetentionDays);
    setAggregateRetentionDays(config.aggregateRetentionDays);
    setTrackScrollDepth(config.trackScrollDepth);
    setTrackSessionDuration(config.trackSessionDuration);
    setTrackOutboundLinks(config.trackOutboundLinks);
    setAllowedOrigins(config.allowedOrigins?.join("\n") ?? "");
    setIgnoredPaths(config.ignoredPaths?.join("\n") ?? "");
    setPublicDashboardEnabled(config.publicDashboardEnabled);
  }, [config]);

  // ---------- Helpers ----------

  const copyToClipboard = useCallback(
    async (text: string, field: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
      } catch {
        toast({
          title: "Copy failed",
          description: "Unable to copy to clipboard.",
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  const handleSave = async () => {
    if (!config) return;
    const data: UpdateAnalyticsConfigData = {
      rawRetentionDays,
      aggregateRetentionDays,
      trackScrollDepth,
      trackSessionDuration,
      trackOutboundLinks,
      allowedOrigins: allowedOrigins
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      ignoredPaths: ignoredPaths
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      publicDashboardEnabled,
      ...(publicDashboardPassword
        ? { publicDashboardPassword }
        : {}),
    };

    try {
      await updateConfig.mutateAsync({ domainId: config.domainId, data });
      setPublicDashboardPassword("");
      toast({
        title: "Settings saved",
        description: "Analytics configuration has been updated.",
      });
    } catch {
      toast({
        title: "Failed to save",
        description: "An error occurred whilst updating the configuration.",
        variant: "destructive",
      });
    }
  };

  const handleRegenerateUuid = async () => {
    if (!config) return;
    try {
      await regenerateUuid.mutateAsync(config.domainId);
      toast({
        title: "Tracking UUID regenerated",
        description:
          "A new tracking UUID has been generated. You will need to update your embed snippet.",
      });
    } catch {
      toast({
        title: "Failed to regenerate UUID",
        description: "An error occurred whilst regenerating the tracking UUID.",
        variant: "destructive",
      });
    }
  };

  const handleRegenerateApiToken = async () => {
    if (!config) return;
    try {
      const response = await regenerateApiToken.mutateAsync(config.domainId);
      const token =
        (response as Record<string, unknown>)?.token ??
        (response as Record<string, unknown>)?.apiToken;
      if (typeof token === "string") {
        setGeneratedApiToken(token);
      }
      toast({
        title: "API token generated",
        description:
          "A new API token has been generated. Make sure to copy it -- it will not be shown again.",
      });
    } catch {
      toast({
        title: "Failed to generate token",
        description: "An error occurred whilst generating the API token.",
        variant: "destructive",
      });
    }
  };

  if (!config) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
          <p>Analytics configuration not found.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tracking UUID */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Tracking UUID
          </CardTitle>
          <CardDescription>
            This unique identifier is used in the tracking script to associate
            events with this domain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={config.trackingUuid}
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                copyToClipboard(config.trackingUuid, "trackingUuid")
              }
            >
              {copiedField === "trackingUuid" ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={regenerateUuid.isPending}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${regenerateUuid.isPending ? "animate-spin" : ""}`}
                  />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Regenerate tracking UUID?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will invalidate the current tracking UUID. You will
                    need to update the embed snippet on your site. Any events
                    sent with the old UUID will be rejected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRegenerateUuid}>
                    Regenerate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* API Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            API Token
          </CardTitle>
          <CardDescription>
            Generate a token to access the analytics API programmatically.
            Tokens are only displayed once after generation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {generatedApiToken && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Copy this token now -- it will not be shown again
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={generatedApiToken}
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    copyToClipboard(generatedApiToken, "apiToken")
                  }
                >
                  {copiedField === "apiToken" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={regenerateApiToken.isPending}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${regenerateApiToken.isPending ? "animate-spin" : ""}`}
                />
                {generatedApiToken ? "Regenerate Token" : "Generate API Token"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {generatedApiToken
                    ? "Regenerate API token?"
                    : "Generate API token?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {generatedApiToken
                    ? "This will invalidate the previous token. Any integrations using the old token will stop working."
                    : "This will generate a new API token for programmatic access to your analytics data."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRegenerateApiToken}>
                  {generatedApiToken ? "Regenerate" : "Generate"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Embed Snippet */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Embed Snippet
          </CardTitle>
          <CardDescription>
            Add this script tag to your site to start collecting analytics data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Textarea
              readOnly
              rows={4}
              value={config.embedSnippet}
              className="font-mono text-xs resize-none"
            />
            <Button
              variant="outline"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => copyToClipboard(config.embedSnippet, "snippet")}
            >
              {copiedField === "snippet" ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Retention Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Retention
          </CardTitle>
          <CardDescription>
            Configure how long raw and aggregated analytics data is retained.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="raw-retention">Raw data retention (days)</Label>
              <Input
                id="raw-retention"
                type="number"
                min={1}
                max={3650}
                value={rawRetentionDays}
                onChange={(e) =>
                  setRawRetentionDays(parseInt(e.target.value, 10) || 1)
                }
              />
              <p className="text-xs text-muted-foreground">
                Individual page views and events. Lower values save storage.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agg-retention">
                Aggregate data retention (days)
              </Label>
              <Input
                id="agg-retention"
                type="number"
                min={1}
                max={3650}
                value={aggregateRetentionDays}
                onChange={(e) =>
                  setAggregateRetentionDays(parseInt(e.target.value, 10) || 1)
                }
              />
              <p className="text-xs text-muted-foreground">
                Rolled-up daily/weekly summaries for long-term trends.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tracking Toggles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MousePointerClick className="h-5 w-5" />
            Tracking Options
          </CardTitle>
          <CardDescription>
            Enable or disable additional tracking features.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Scroll depth</Label>
              <p className="text-xs text-muted-foreground">
                Track how far visitors scroll down each page.
              </p>
            </div>
            <Switch
              checked={trackScrollDepth}
              onCheckedChange={setTrackScrollDepth}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Session duration</Label>
              <p className="text-xs text-muted-foreground">
                Measure the time visitors spend in each session.
              </p>
            </div>
            <Switch
              checked={trackSessionDuration}
              onCheckedChange={setTrackSessionDuration}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Outbound links</Label>
              <p className="text-xs text-muted-foreground">
                Automatically track clicks on external links.
              </p>
            </div>
            <Switch
              checked={trackOutboundLinks}
              onCheckedChange={setTrackOutboundLinks}
            />
          </div>
        </CardContent>
      </Card>

      {/* Allowed Origins */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Allowed Origins
          </CardTitle>
          <CardDescription>
            Restrict which origins can send tracking data. Leave empty to allow
            all origins. Enter one origin per line.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            placeholder={"https://example.com\nhttps://www.example.com"}
            value={allowedOrigins}
            onChange={(e) => setAllowedOrigins(e.target.value)}
            className="font-mono text-sm"
          />
        </CardContent>
      </Card>

      {/* Ignored Paths */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Ignored Paths
          </CardTitle>
          <CardDescription>
            Page paths that should not be tracked. Supports glob patterns. Enter
            one path per line.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            placeholder={"/admin/*\n/api/*\n/health"}
            value={ignoredPaths}
            onChange={(e) => setIgnoredPaths(e.target.value)}
            className="font-mono text-sm"
          />
        </CardContent>
      </Card>

      {/* Public Dashboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Public Dashboard
          </CardTitle>
          <CardDescription>
            Allow anyone with the link to view a read-only version of your
            analytics dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable public dashboard</Label>
              <p className="text-xs text-muted-foreground">
                Visitors will be able to view summary data without
                authentication.
              </p>
            </div>
            <Switch
              checked={publicDashboardEnabled}
              onCheckedChange={setPublicDashboardEnabled}
            />
          </div>
          {config.publicDashboardEnabled && config.publicDashboardToken && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Password protection
                </Label>
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  {config.hasPublicDashboardPassword ? (
                    <p className="text-sm text-muted-foreground">
                      Password is set. Enter a new one below to change it.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No password set. Anyone with the link can view the dashboard.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    placeholder={config.hasPublicDashboardPassword ? "Enter new password" : "Set a password (optional)"}
                    value={publicDashboardPassword}
                    onChange={(e) => setPublicDashboardPassword(e.target.value)}
                    className="text-sm"
                  />
                  {config.hasPublicDashboardPassword && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (!config) return;
                        try {
                          await updateConfig.mutateAsync({
                            domainId: config.domainId,
                            data: { publicDashboardPassword: null },
                          });
                          toast({
                            title: "Password removed",
                            description: "The public dashboard is no longer password-protected.",
                          });
                        } catch {
                          toast({
                            title: "Failed to remove password",
                            description: "An error occurred.",
                            variant: "destructive",
                          });
                        }
                      }}
                      disabled={updateConfig.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Shareable link
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/analytics/public/${config.publicDashboardToken}`}
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      copyToClipboard(
                        `${window.location.origin}/analytics/public/${config.publicDashboardToken}`,
                        "publicUrl"
                      )
                    }
                  >
                    {copiedField === "publicUrl" ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={rotatePublicToken.isPending}
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${rotatePublicToken.isPending ? "animate-spin" : ""}`}
                        />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Rotate public dashboard link?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will invalidate the current link. Anyone using the
                          old link will no longer be able to access the dashboard.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            if (!config) return;
                            try {
                              await rotatePublicToken.mutateAsync(config.domainId);
                              toast({
                                title: "Link rotated",
                                description: "A new public dashboard link has been generated.",
                              });
                            } catch {
                              toast({
                                title: "Failed to rotate link",
                                description: "An error occurred whilst rotating the public dashboard link.",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          Rotate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              {pomeriumEnabled && (
                <>
                  <Separator />
                  <div className="flex items-start gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Pomerium is enabled. If this domain is behind Pomerium, you
                      will need to add a route policy that allows access to the{" "}
                      <code className="text-xs">/analytics/public/*</code> path
                      for your intended audience (e.g. specific users, groups, or
                      public access).
                    </p>
                  </div>
                </>
              )}
            </>
          )}
          {publicDashboardEnabled && !config.publicDashboardEnabled && (
            <p className="text-xs text-muted-foreground mt-2">
              Save settings to generate a shareable link.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updateConfig.isPending}
          size="lg"
        >
          {updateConfig.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Settings"
          )}
        </Button>
      </div>
    </div>
  );
}
