"use client";

import { useState } from "react";
import { Shield, AlertCircle, Users, Route, Settings } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Alert,
  AlertDescription,
  AlertTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Badge,
} from "@uni-proxy-manager/ui";
import { usePomeriumExtensionEnabled, usePomeriumStatus } from "@/hooks";
import { IdentityProvidersTab } from "./_components/identity-providers-tab";
import { ProtectedRoutesTab } from "./_components/protected-routes-tab";
import { SettingsTab } from "./_components/settings-tab";

export default function PomeriumPage() {
  const { enabled: pomeriumEnabled, isLoading: extensionLoading } =
    usePomeriumExtensionEnabled();
  const { data: status, isLoading: statusLoading } = usePomeriumStatus();

  if (extensionLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!pomeriumEnabled) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Access Control</h1>
          <p className="text-muted-foreground">
            Identity-aware access control with Pomerium.
          </p>
        </div>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Pomerium Extension Not Enabled</AlertTitle>
          <AlertDescription>
            The Pomerium extension is not enabled. To enable it, include the{" "}
            <code className="bg-muted px-1 py-0.5 rounded">
              docker-compose.pomerium.yml
            </code>{" "}
            overlay in your deployment.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Access Control</h1>
            <p className="text-muted-foreground">
              Manage identity providers and route protection with Pomerium.
            </p>
          </div>
        </div>
        {status && (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {status.enabled ? (
                status.healthy ? (
                  <Badge variant="default" className="bg-green-600">
                    Healthy
                  </Badge>
                ) : (
                  <Badge variant="destructive">Unhealthy</Badge>
                )
              ) : (
                <Badge variant="secondary">Disabled</Badge>
              )}
            </div>
            {status.enabled && !status.healthy && (
              <Alert variant="destructive" className="max-w-xs">
                <AlertTitle>Pomerium Unhealthy</AlertTitle>
                <AlertDescription>
                  {status.error ?? "Pomerium health check failed"}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>

      <Tabs defaultValue="routes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="routes" className="flex items-center gap-2">
            <Route className="h-4 w-4" />
            Protected Routes
          </TabsTrigger>
          <TabsTrigger value="providers" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Identity Providers
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="routes">
          <ProtectedRoutesTab />
        </TabsContent>

        <TabsContent value="providers">
          <IdentityProvidersTab />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
