"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uni-proxy-manager/ui";
import { HaproxySettings } from "./_components/haproxy-settings";
import { SystemSettings } from "./_components/system-settings";
import { ExportImportSettings } from "./_components/export-import-settings";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("haproxy");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage application settings and configuration.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="haproxy">HAProxy</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="export-import">Export / Import</TabsTrigger>
        </TabsList>

        <TabsContent value="haproxy" className="mt-6">
          <HaproxySettings />
        </TabsContent>

        <TabsContent value="system" className="mt-6">
          <SystemSettings />
        </TabsContent>

        <TabsContent value="export-import" className="mt-6">
          <ExportImportSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
