"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@uni-proxy-manager/ui";
import { useUpdateSite, useSiteEnv, useUpdateSiteEnv } from "@/hooks";
import type { Site, SiteFramework, SiteRenderMode } from "@/lib/types";
import { EnvVariablesEditor } from "./env-variables-editor";

interface SiteSettingsProps {
  site: Site;
}

export function SiteSettings({ site }: SiteSettingsProps) {
  const { toast } = useToast();
  const updateSite = useUpdateSite();
  const { data: envVars } = useSiteEnv(site.id);
  const updateEnv = useUpdateSiteEnv();

  const [buildCommand, setBuildCommand] = useState(site.buildCommand || "");
  const [installCommand, setInstallCommand] = useState(site.installCommand || "");
  const [outputDirectory, setOutputDirectory] = useState(site.outputDirectory || "");
  const [nodeVersion, setNodeVersion] = useState(site.nodeVersion || "20");
  const [memoryMb, setMemoryMb] = useState(site.memoryMb);
  const [cpuLimit, setCpuLimit] = useState(site.cpuLimit);
  const [timeoutSeconds, setTimeoutSeconds] = useState(site.timeoutSeconds);
  const [maxConcurrency, setMaxConcurrency] = useState(site.maxConcurrency);
  const [coldStartEnabled, setColdStartEnabled] = useState(site.coldStartEnabled);

  const handleSaveBuild = async () => {
    try {
      await updateSite.mutateAsync({
        id: site.id,
        data: {
          buildCommand: buildCommand || undefined,
          installCommand: installCommand || undefined,
          outputDirectory: outputDirectory || undefined,
          nodeVersion: nodeVersion || undefined,
        },
      });
      toast({
        title: "Build settings saved",
        description: "Your build configuration has been updated.",
      });
    } catch (error) {
      toast({
        title: "Failed to save",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleSaveRuntime = async () => {
    try {
      await updateSite.mutateAsync({
        id: site.id,
        data: {
          memoryMb,
          cpuLimit,
          timeoutSeconds,
          maxConcurrency,
          coldStartEnabled,
        },
      });
      toast({
        title: "Runtime settings saved",
        description: "Your runtime configuration has been updated.",
      });
    } catch (error) {
      toast({
        title: "Failed to save",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleSaveEnv = async (vars: Record<string, string>) => {
    try {
      await updateEnv.mutateAsync({
        id: site.id,
        envVariables: vars,
      });
      toast({
        title: "Environment variables saved",
        description: "Your environment variables have been updated.",
      });
    } catch (error) {
      toast({
        title: "Failed to save",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <Tabs defaultValue="build" className="space-y-4">
      <TabsList>
        <TabsTrigger value="build">Build</TabsTrigger>
        <TabsTrigger value="runtime">Runtime</TabsTrigger>
        <TabsTrigger value="env">Environment</TabsTrigger>
      </TabsList>

      <TabsContent value="build" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Build Configuration</CardTitle>
            <CardDescription>
              Configure how your site is built and deployed
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="framework">Framework</Label>
                <Select
                  value={site.framework}
                  onValueChange={(value) =>
                    updateSite.mutate({
                      id: site.id,
                      data: { framework: value as SiteFramework },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nextjs">Next.js</SelectItem>
                    <SelectItem value="sveltekit">SvelteKit</SelectItem>
                    <SelectItem value="static">Static</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="renderMode">Render Mode</Label>
                <Select
                  value={site.renderMode}
                  onValueChange={(value) =>
                    updateSite.mutate({
                      id: site.id,
                      data: { renderMode: value as SiteRenderMode },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssr">SSR</SelectItem>
                    <SelectItem value="ssg">SSG</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="nodeVersion">Node.js Version</Label>
              <Select value={nodeVersion} onValueChange={setNodeVersion}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="18">Node.js 18</SelectItem>
                  <SelectItem value="20">Node.js 20</SelectItem>
                  <SelectItem value="22">Node.js 22</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="installCommand">Install Command</Label>
              <Input
                id="installCommand"
                value={installCommand}
                onChange={(e) => setInstallCommand(e.target.value)}
                placeholder="npm install"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="buildCommand">Build Command</Label>
              <Input
                id="buildCommand"
                value={buildCommand}
                onChange={(e) => setBuildCommand(e.target.value)}
                placeholder="npm run build"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="outputDirectory">Output Directory</Label>
              <Input
                id="outputDirectory"
                value={outputDirectory}
                onChange={(e) => setOutputDirectory(e.target.value)}
                placeholder=".next"
              />
            </div>

            <Button onClick={handleSaveBuild} disabled={updateSite.isPending}>
              {updateSite.isPending ? "Saving..." : "Save Build Settings"}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="runtime" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Runtime Configuration</CardTitle>
            <CardDescription>
              Configure resource limits and runtime behavior
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-2">
              <Label>Memory Limit: {memoryMb >= 1024 ? `${(memoryMb / 1024).toFixed(1)}GB` : `${memoryMb}MB`}</Label>
              <Slider
                value={[memoryMb]}
                onValueChange={([value]) => setMemoryMb(value)}
                min={128}
                max={16384}
                step={128}
              />
              <p className="text-xs text-muted-foreground">
                Maximum memory allocation (128MB - 16GB)
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="cpuLimit">CPU Limit</Label>
              <Select value={cpuLimit} onValueChange={setCpuLimit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.25">0.25 vCPU</SelectItem>
                  <SelectItem value="0.5">0.5 vCPU</SelectItem>
                  <SelectItem value="1">1 vCPU</SelectItem>
                  <SelectItem value="2">2 vCPU</SelectItem>
                  <SelectItem value="4">4 vCPU</SelectItem>
                  <SelectItem value="8">8 vCPU</SelectItem>
                  <SelectItem value="16">16 vCPU</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Request Timeout: {timeoutSeconds >= 60 ? `${Math.floor(timeoutSeconds / 60)}m ${timeoutSeconds % 60}s` : `${timeoutSeconds}s`}</Label>
              <Slider
                value={[timeoutSeconds]}
                onValueChange={([value]) => setTimeoutSeconds(value)}
                min={5}
                max={900}
                step={5}
              />
              <p className="text-xs text-muted-foreground">
                Maximum time for a single request (5s - 15min)
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Max Concurrency: {maxConcurrency}</Label>
              <Slider
                value={[maxConcurrency]}
                onValueChange={([value]) => setMaxConcurrency(value)}
                min={1}
                max={1000}
                step={10}
              />
              <p className="text-xs text-muted-foreground">
                Maximum concurrent requests per instance (1 - 1000)
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">Cold Start</p>
                <p className="text-sm text-muted-foreground">
                  Enable instance recycling to reduce costs
                </p>
              </div>
              <Switch
                checked={coldStartEnabled}
                onCheckedChange={setColdStartEnabled}
              />
            </div>

            <Button onClick={handleSaveRuntime} disabled={updateSite.isPending}>
              {updateSite.isPending ? "Saving..." : "Save Runtime Settings"}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="env" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Environment Variables</CardTitle>
            <CardDescription>
              Configure environment variables for your site builds and runtime
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EnvVariablesEditor
              variables={envVars?.envVariables || site.envVariables || {}}
              onSave={handleSaveEnv}
              isSaving={updateEnv.isPending}
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
