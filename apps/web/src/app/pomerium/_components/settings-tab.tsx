"use client";

import { RefreshCw, Save, AlertTriangle, RotateCcw } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@uni-proxy-manager/ui";
import {
  usePomeriumSettings,
  useUpdatePomeriumSettings,
  useRegeneratePomeriumSecrets,
  usePomeriumStatus,
  useRestartPomerium,
} from "@/hooks";
import { useForm, Controller } from "react-hook-form";
import type { UpdatePomeriumSettingsData, PomeriumSettings, PomeriumStatus } from "@/lib/types";

// Outer component — handles loading state only.
// SettingsForm only mounts when settings is available, so defaultValues
// are populated synchronously from real data — no timing issues.
export function SettingsTab() {
  const { data: settings, isLoading } = usePomeriumSettings();
  const { data: status } = usePomeriumStatus();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // key={settings?.updatedAt} forces a remount (fresh defaultValues) after a save.
  return (
    <SettingsForm
      key={settings?.updatedAt ?? "init"}
      settings={settings ?? null}
      status={status ?? null}
    />
  );
}

// Inner component — only mounts when settings is loaded.
// useForm defaultValues come directly from props, so the Select/Switch/Input
// fields are pre-populated on the very first render with no useEffect needed.
function SettingsForm({
  settings,
  status,
}: {
  settings: PomeriumSettings | null;
  status: PomeriumStatus | null;
}) {
  const updateSettings = useUpdatePomeriumSettings();
  const regenerateSecrets = useRegeneratePomeriumSecrets();
  const restartPomerium = useRestartPomerium();

  const form = useForm<UpdatePomeriumSettingsData>({
    defaultValues: {
      authenticateServiceUrl: settings?.authenticateServiceUrl || "",
      cookieName: settings?.cookieName || "_pomerium",
      cookieExpire: settings?.cookieExpire || "14h",
      cookieDomain: settings?.cookieDomain || "",
      cookieSecure: settings?.cookieSecure ?? true,
      cookieHttpOnly: settings?.cookieHttpOnly ?? true,
      logLevel: (settings?.logLevel as "debug" | "info" | "warn" | "error") || "info",
      enabled: settings?.enabled ?? false,
    },
  });

  const onSubmit = async (data: UpdatePomeriumSettingsData) => {
    await updateSettings.mutateAsync(data);
  };

  const handleRegenerateSecrets = async () => {
    if (
      confirm(
        "Are you sure you want to regenerate all secrets? This will require restarting Pomerium."
      )
    ) {
      await regenerateSecrets.mutateAsync();
    }
  };

  const handleRestart = async () => {
    if (
      confirm(
        "Restart Pomerium? This will briefly interrupt all protected routes."
      )
    ) {
      await restartPomerium.mutateAsync();
    }
  };

  return (
    <div className="space-y-6">
      {status && !status.configured && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Configuration Required</AlertTitle>
          <AlertDescription>
            Pomerium is not fully configured. Please set the Authenticate
            Service URL and add at least one identity provider.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
            <CardDescription>
              Configure Pomerium authentication settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Pomerium</Label>
                <p className="text-sm text-muted-foreground">
                  Enable or disable Pomerium authentication globally.
                </p>
              </div>
              <Controller
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="authenticateServiceUrl">
                Authenticate Service URL
              </Label>
              <Input
                id="authenticateServiceUrl"
                placeholder="https://auth.example.com"
                {...form.register("authenticateServiceUrl")}
              />
              <p className="text-sm text-muted-foreground">
                Public URL where users will be redirected to authenticate.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cookieName">Cookie Name</Label>
                <Input
                  id="cookieName"
                  placeholder="_pomerium"
                  {...form.register("cookieName")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cookieExpire">Cookie Expiration</Label>
                <Input
                  id="cookieExpire"
                  placeholder="14h"
                  {...form.register("cookieExpire")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cookieDomain">Cookie Domain</Label>
              <Input
                id="cookieDomain"
                placeholder=".example.com"
                {...form.register("cookieDomain")}
              />
              <p className="text-sm text-muted-foreground">
                Domain for the authentication cookie. Leave empty for default.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Secure Cookie</Label>
                <p className="text-sm text-muted-foreground">
                  Only send cookie over HTTPS.
                </p>
              </div>
              <Controller
                control={form.control}
                name="cookieSecure"
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>HTTP-Only Cookie</Label>
                <p className="text-sm text-muted-foreground">
                  Prevent JavaScript access to the cookie.
                </p>
              </div>
              <Controller
                control={form.control}
                name="cookieHttpOnly"
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
            </div>

            <div className="space-y-2">
              <Label>Log Level</Label>
              <Controller
                control={form.control}
                name="logLevel"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select log level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="debug">Debug</SelectItem>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="warn">Warning</SelectItem>
                      <SelectItem value="error">Error</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateSettings.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Save Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Manage cryptographic secrets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Shared Secret</Label>
              <p className="text-sm text-muted-foreground">
                {settings?.sharedSecret || "Not configured"}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Cookie Secret</Label>
              <p className="text-sm text-muted-foreground">
                {settings?.cookieSecret || "Not configured"}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Signing Key</Label>
              <p className="text-sm text-muted-foreground">
                {settings?.signingKey || "Not configured"}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleRestart}
              disabled={restartPomerium.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Restart Service
            </Button>
            <Button
              variant="outline"
              onClick={handleRegenerateSecrets}
              disabled={regenerateSecrets.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate Secrets
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
