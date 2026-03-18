"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Slider,
  Skeleton,
  useToast,
} from "@uni-proxy-manager/ui";
import { Settings, RotateCcw, Save, Loader2, Cpu } from "lucide-react";
import {
  useRetentionConfig,
  useUpdateRetentionConfig,
  useResetRetentionConfig,
  useBuildDefaultsConfig,
  useUpdateBuildDefaultsConfig,
  useResetBuildDefaultsConfig,
} from "@/hooks";

const retentionFormSchema = z.object({
  maxDeploymentsPerSite: z.coerce.number().int().min(1).max(100),
  deploymentMaxAgeDays: z.coerce.number().int().min(1).max(365),
  artifactRetentionDays: z.coerce.number().int().min(1).max(365),
  logRetentionDays: z.coerce.number().int().min(1).max(365),
});

const buildDefaultsFormSchema = z.object({
  defaultBuildCpus: z.coerce.number().min(0.5).max(8),
  defaultBuildMemoryMb: z.coerce.number().int().min(512).max(16384),
  defaultBuildTimeoutSeconds: z.coerce.number().int().min(60).max(3600),
});

type RetentionFormValues = z.infer<typeof retentionFormSchema>;
type BuildDefaultsFormValues = z.infer<typeof buildDefaultsFormSchema>;

export function SystemSettings() {
  const { toast } = useToast();
  const { data: retentionConfig, isLoading: isLoadingRetention } = useRetentionConfig();
  const updateRetentionConfig = useUpdateRetentionConfig();
  const resetRetentionConfig = useResetRetentionConfig();

  const { data: buildDefaultsConfig, isLoading: isLoadingBuildDefaults } = useBuildDefaultsConfig();
  const updateBuildDefaultsConfig = useUpdateBuildDefaultsConfig();
  const resetBuildDefaultsConfig = useResetBuildDefaultsConfig();

  const retentionForm = useForm<RetentionFormValues>({
    resolver: zodResolver(retentionFormSchema),
    defaultValues: {
      maxDeploymentsPerSite: 10,
      deploymentMaxAgeDays: 90,
      artifactRetentionDays: 30,
      logRetentionDays: 30,
    },
  });

  const buildDefaultsForm = useForm<BuildDefaultsFormValues>({
    resolver: zodResolver(buildDefaultsFormSchema),
    defaultValues: {
      defaultBuildCpus: 1.0,
      defaultBuildMemoryMb: 2048,
      defaultBuildTimeoutSeconds: 900,
    },
  });

  // Update retention form when config loads
  useEffect(() => {
    if (retentionConfig) {
      retentionForm.reset(retentionConfig);
    }
  }, [retentionConfig, retentionForm]);

  // Update build defaults form when config loads
  useEffect(() => {
    if (buildDefaultsConfig) {
      buildDefaultsForm.reset(buildDefaultsConfig);
    }
  }, [buildDefaultsConfig, buildDefaultsForm]);

  const onRetentionSubmit = async (data: RetentionFormValues) => {
    try {
      await updateRetentionConfig.mutateAsync(data);
      toast({
        title: "Settings saved",
        description: "Retention configuration has been updated.",
      });
    } catch (error) {
      toast({
        title: "Failed to save",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleRetentionReset = async () => {
    try {
      await resetRetentionConfig.mutateAsync();
      toast({
        title: "Settings reset",
        description: "Retention configuration has been reset to defaults.",
      });
    } catch (error) {
      toast({
        title: "Failed to reset",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const onBuildDefaultsSubmit = async (data: BuildDefaultsFormValues) => {
    try {
      await updateBuildDefaultsConfig.mutateAsync(data);
      toast({
        title: "Settings saved",
        description: "Build defaults configuration has been updated.",
      });
    } catch (error) {
      toast({
        title: "Failed to save",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleBuildDefaultsReset = async () => {
    try {
      await resetBuildDefaultsConfig.mutateAsync();
      toast({
        title: "Settings reset",
        description: "Build defaults configuration has been reset to defaults.",
      });
    } catch (error) {
      toast({
        title: "Failed to reset",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const isLoading = isLoadingRetention || isLoadingBuildDefaults;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[400px]" />
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Retention Configuration
          </CardTitle>
          <CardDescription>
            Configure automatic cleanup policies for deployments, artifacts, and logs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...retentionForm}>
            <form onSubmit={retentionForm.handleSubmit(onRetentionSubmit)} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={retentionForm.control}
                  name="maxDeploymentsPerSite"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Deployments Per Site</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={100} {...field} />
                      </FormControl>
                      <FormDescription>
                        Oldest deployments will be deleted when this limit is exceeded.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={retentionForm.control}
                  name="deploymentMaxAgeDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Deployment Max Age (days)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={365} {...field} />
                      </FormControl>
                      <FormDescription>
                        Deployments older than this will be automatically deleted.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={retentionForm.control}
                  name="artifactRetentionDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Artifact Retention (days)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={365} {...field} />
                      </FormControl>
                      <FormDescription>
                        Keep artifacts for this many days after deployment is deleted.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={retentionForm.control}
                  name="logRetentionDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Log Retention (days)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={365} {...field} />
                      </FormControl>
                      <FormDescription>
                        Build logs will be deleted after this many days.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex items-center gap-4">
                <Button type="submit" disabled={updateRetentionConfig.isPending}>
                  {updateRetentionConfig.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Changes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRetentionReset}
                  disabled={resetRetentionConfig.isPending}
                >
                  {resetRetentionConfig.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Reset to Defaults
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Build Defaults
          </CardTitle>
          <CardDescription>
            Configure default resource limits for site builds. These apply to new sites unless overridden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...buildDefaultsForm}>
            <form onSubmit={buildDefaultsForm.handleSubmit(onBuildDefaultsSubmit)} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-3">
                <FormField
                  control={buildDefaultsForm.control}
                  name="defaultBuildCpus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default CPUs</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Slider
                            min={0.5}
                            max={8}
                            step={0.5}
                            value={[field.value]}
                            onValueChange={(v) => field.onChange(v[0])}
                          />
                          <div className="text-sm text-muted-foreground text-center">
                            {field.value} CPUs
                          </div>
                        </div>
                      </FormControl>
                      <FormDescription>
                        CPU allocation for build containers.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={buildDefaultsForm.control}
                  name="defaultBuildMemoryMb"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Memory</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Slider
                            min={512}
                            max={16384}
                            step={512}
                            value={[field.value]}
                            onValueChange={(v) => field.onChange(v[0])}
                          />
                          <div className="text-sm text-muted-foreground text-center">
                            {(field.value / 1024).toFixed(1)} GB
                          </div>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Memory allocation for build containers.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={buildDefaultsForm.control}
                  name="defaultBuildTimeoutSeconds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Timeout</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Slider
                            min={60}
                            max={3600}
                            step={60}
                            value={[field.value]}
                            onValueChange={(v) => field.onChange(v[0])}
                          />
                          <div className="text-sm text-muted-foreground text-center">
                            {Math.floor(field.value / 60)} minutes
                          </div>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Maximum build time before timeout.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex items-center gap-4">
                <Button type="submit" disabled={updateBuildDefaultsConfig.isPending}>
                  {updateBuildDefaultsConfig.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Changes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBuildDefaultsReset}
                  disabled={resetBuildDefaultsConfig.isPending}
                >
                  {resetBuildDefaultsConfig.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Reset to Defaults
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About Retention Cleanup</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            The retention cleanup job runs daily to enforce these policies:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Deletes deployments exceeding the max count per site (oldest first, active deployments are preserved)</li>
            <li>Removes deployments older than the max age</li>
            <li>Cleans up orphaned artifacts after the retention period</li>
            <li>Truncates old build logs to save database space</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
