"use client";

import { useState, useMemo } from "react";
import {
  Filter,
  Plus,
  Trash2,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  Users,
  AlertCircle,
  X,
  Clock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from "@uni-proxy-manager/ui";
import {
  useAnalyticsFunnels,
  useAnalyticsFunnelResults,
  useCreateAnalyticsFunnel,
  useDeleteAnalyticsFunnel,
  useUpdateAnalyticsFunnel,
  useRecomputeAnalyticsFunnel,
} from "@/hooks/use-analytics-funnels";
import type {
  AnalyticsFunnel,
  AnalyticsFunnelResult,
  AnalyticsFunnelStep,
} from "@/lib/types";

interface FunnelsTabProps {
  configId: string;
}

// ---------------------------------------------------------------------------
// Analysis window options (human-readable label + days value)
// ---------------------------------------------------------------------------

const ANALYSIS_WINDOW_OPTIONS = [
  { label: "1 hour", days: 0.042 }, // ~1h expressed in days (sent as fractional but API rounds)
  { label: "24 hours", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
] as const;

/** Convert a days value to a string key usable in the Select. */
function daysToKey(days: number): string {
  return String(days);
}

// ---------------------------------------------------------------------------
// Funnel result card (with its own results query)
// ---------------------------------------------------------------------------

function FunnelCard({
  funnel,
  configId,
  onDelete,
  onRecompute,
  onToggleEnabled,
  onWindowChange,
  isDeleting,
  isRecomputing,
  isToggling,
  isUpdatingWindow,
}: {
  funnel: AnalyticsFunnel;
  configId: string;
  onDelete: (funnelId: string) => void;
  onRecompute: (funnelId: string) => void;
  onToggleEnabled: (funnelId: string, enabled: boolean) => void;
  onWindowChange: (funnelId: string, days: number) => void;
  isDeleting: boolean;
  isRecomputing: boolean;
  isToggling: boolean;
  isUpdatingWindow: boolean;
}) {
  const { data: resultsData, isLoading: resultsLoading } =
    useAnalyticsFunnelResults(configId, funnel.id);

  const results: AnalyticsFunnelResult | null = resultsData?.results ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">{funnel.name}</CardTitle>
            <Badge variant={funnel.enabled ? "default" : "secondary"}>
              {funnel.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {/* Enable/disable toggle */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center">
                    <Switch
                      checked={funnel.enabled}
                      onCheckedChange={(checked) =>
                        onToggleEnabled(funnel.id, checked)
                      }
                      disabled={isToggling}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {funnel.enabled ? "Disable funnel" : "Enable funnel"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Analysis window selector */}
            <Select
              value={daysToKey(
                funnel.windowMs / (24 * 60 * 60 * 1000)
              )}
              onValueChange={(v) => onWindowChange(funnel.id, Number(v))}
              disabled={isUpdatingWindow}
            >
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <Clock className="h-3 w-3 mr-1 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANALYSIS_WINDOW_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.label}
                    value={daysToKey(opt.days)}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRecompute(funnel.id)}
                    disabled={isRecomputing}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${isRecomputing ? "animate-spin" : ""}`}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Recompute results</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" disabled={isDeleting}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete funnel</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete &ldquo;{funnel.name}&rdquo;?
                    This action cannot be undone and all associated results will
                    be permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(funnel.id)}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {funnel.description && (
          <CardDescription>{funnel.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {/* Steps definition */}
        <div className="mb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Steps
          </p>
          <div className="flex items-center gap-1 flex-wrap text-sm">
            {funnel.steps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <Badge variant="outline" className="font-mono text-xs">
                  {step.type === "pageview"
                    ? step.pathPattern ?? "/"
                    : step.eventName ?? step.name}
                </Badge>
                {idx < funnel.steps.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </div>

        <Separator className="my-4" />

        {/* Funnel visualisation */}
        {resultsLoading ? (
          <div className="space-y-3">
            {funnel.steps.map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : results ? (
          <FunnelVisualisation steps={funnel.steps} results={results} />
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm">
              No results computed yet. Click the refresh button to compute.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Horizontal funnel visualisation (with dropoff display)
// ---------------------------------------------------------------------------

function FunnelVisualisation({
  steps,
  results,
}: {
  steps: AnalyticsFunnelStep[];
  results: AnalyticsFunnelResult;
}) {
  const maxCount = results.totalEntrants || 1;

  return (
    <div className="space-y-0">
      {/* Overall conversion */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>{results.totalEntrants.toLocaleString()} total entrants</span>
        </div>
        <Badge variant="secondary" className="text-sm">
          {(results.overallConversionRate * 100).toFixed(1)}% overall conversion
        </Badge>
      </div>

      {/* Step bars */}
      <div className="space-y-2">
        {steps.map((step, idx) => {
          const count = results.stepCounts[idx] ?? 0;
          const prevCount = idx > 0 ? (results.stepCounts[idx - 1] ?? 0) : count;
          const widthPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
          const stepRate = results.stepConversionRates[idx] ?? 0;

          // Compute dropoff between this step and the previous one.
          const dropoffCount = idx > 0 ? prevCount - count : 0;
          const dropoffPct =
            idx > 0 && prevCount > 0
              ? ((prevCount - count) / prevCount) * 100
              : 0;

          return (
            <div key={idx}>
              {/* Conversion rate and dropoff between steps */}
              {idx > 0 && (
                <div className="flex items-center justify-between py-1 pl-4 pr-2">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {(stepRate * 100).toFixed(1)}% conversion
                    </span>
                  </div>
                  {dropoffCount > 0 && (
                    <div className="flex items-center gap-1">
                      <ChevronDown className="h-3 w-3 text-red-400" />
                      <span className="text-xs text-red-500">
                        {dropoffCount.toLocaleString()} dropped off ({dropoffPct.toFixed(1)}%)
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3">
                {/* Step label */}
                <div className="w-32 shrink-0 text-right">
                  <p className="text-sm font-medium truncate" title={step.name}>
                    {step.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {step.type === "pageview" ? "Page view" : "Event"}
                  </p>
                </div>

                {/* Bar */}
                <div className="flex-1 h-10 rounded bg-muted relative overflow-hidden">
                  <div
                    className="h-full rounded bg-primary/80 transition-all duration-500 flex items-center justify-end px-3"
                    style={{ width: `${Math.max(widthPct, 2)}%` }}
                  >
                    {widthPct > 15 && (
                      <span className="text-xs font-medium text-primary-foreground">
                        {count.toLocaleString()}
                      </span>
                    )}
                  </div>
                  {widthPct <= 15 && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                      {count.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {results.computedAt && (
        <p className="text-xs text-muted-foreground mt-4">
          Last computed: {new Date(results.computedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create funnel dialog
// ---------------------------------------------------------------------------

function CreateFunnelDialog({
  configId,
  open,
  onOpenChange,
}: {
  configId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const createFunnel = useCreateAnalyticsFunnel();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [analysisWindowDays, setAnalysisWindowDays] = useState<number>(7);
  const [steps, setSteps] = useState<AnalyticsFunnelStep[]>([
    { name: "", type: "pageview", pathPattern: "" },
    { name: "", type: "pageview", pathPattern: "" },
  ]);

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      { name: "", type: "pageview", pathPattern: "" },
    ]);
  };

  const removeStep = (idx: number) => {
    if (steps.length <= 2) return;
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateStep = (
    idx: number,
    field: keyof AnalyticsFunnelStep,
    value: string
  ) => {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const updated = { ...s, [field]: value };
        // When changing type, reset the irrelevant field.
        if (field === "type") {
          if (value === "pageview") {
            updated.eventName = undefined;
            updated.pathPattern = updated.pathPattern ?? "";
          } else {
            updated.pathPattern = undefined;
            updated.eventName = updated.eventName ?? "";
          }
        }
        return updated;
      })
    );
  };

  const isValid = useMemo(() => {
    if (!name.trim()) return false;
    if (steps.length < 2) return false;
    return steps.every((s) => {
      if (!s.name.trim()) return false;
      if (s.type === "pageview" && !s.pathPattern?.trim()) return false;
      if (s.type === "event" && !s.eventName?.trim()) return false;
      return true;
    });
  }, [name, steps]);

  const handleSubmit = async () => {
    if (!isValid) return;
    try {
      await createFunnel.mutateAsync({
        configId,
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          analysisWindowDays,
          steps: steps.map((s) => ({
            name: s.name.trim(),
            type: s.type,
            ...(s.type === "pageview"
              ? { pathPattern: s.pathPattern?.trim() }
              : { eventName: s.eventName?.trim() }),
          })),
        },
      });
      toast({
        title: "Funnel created",
        description: `"${name.trim()}" has been created successfully.`,
      });
      onOpenChange(false);
      resetForm();
    } catch {
      toast({
        title: "Failed to create funnel",
        description: "An error occurred whilst creating the funnel.",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setAnalysisWindowDays(7);
    setSteps([
      { name: "", type: "pageview", pathPattern: "" },
      { name: "", type: "pageview", pathPattern: "" },
    ]);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetForm();
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Funnel</DialogTitle>
          <DialogDescription>
            Define a conversion funnel by specifying a sequence of steps.
            Each step can be a page view or a custom event.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="funnel-name">Name</Label>
            <Input
              id="funnel-name"
              placeholder="e.g. Sign-up flow"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="funnel-desc">Description (optional)</Label>
            <Input
              id="funnel-desc"
              placeholder="Brief description of this funnel"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Analysis window */}
          <div className="space-y-2">
            <Label>Analysis window</Label>
            <Select
              value={daysToKey(analysisWindowDays)}
              onValueChange={(v) => setAnalysisWindowDays(Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANALYSIS_WINDOW_OPTIONS.map((opt) => (
                  <SelectItem key={opt.label} value={daysToKey(opt.days)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The time window over which funnel conversions are measured.
            </p>
          </div>

          <Separator />

          {/* Steps */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Steps (minimum 2)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addStep}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add step
              </Button>
            </div>
            {steps.map((step, idx) => (
              <div
                key={idx}
                className="rounded-md border p-3 space-y-2 relative"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Step {idx + 1}
                  </span>
                  {steps.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeStep(idx)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Step name</Label>
                    <Input
                      placeholder="e.g. Landing page"
                      value={step.name}
                      onChange={(e) => updateStep(idx, "name", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={step.type}
                      onValueChange={(v) => updateStep(idx, "type", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pageview">Page view</SelectItem>
                        <SelectItem value="event">Event</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {step.type === "pageview" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Path pattern</Label>
                    <Input
                      placeholder="e.g. /pricing"
                      value={step.pathPattern ?? ""}
                      onChange={(e) =>
                        updateStep(idx, "pathPattern", e.target.value)
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs">Event name</Label>
                    <Input
                      placeholder="e.g. click_signup"
                      value={step.eventName ?? ""}
                      onChange={(e) =>
                        updateStep(idx, "eventName", e.target.value)
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || createFunnel.isPending}
          >
            {createFunnel.isPending ? "Creating..." : "Create Funnel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FunnelsTab({ configId }: FunnelsTabProps) {
  const { data: funnels, isLoading } = useAnalyticsFunnels(configId);
  const deleteFunnel = useDeleteAnalyticsFunnel();
  const updateFunnel = useUpdateAnalyticsFunnel();
  const recomputeFunnel = useRecomputeAnalyticsFunnel();
  const { toast } = useToast();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const handleDelete = async (funnelId: string) => {
    try {
      await deleteFunnel.mutateAsync({ configId, funnelId });
      toast({
        title: "Funnel deleted",
        description: "The funnel has been permanently removed.",
      });
    } catch {
      toast({
        title: "Failed to delete funnel",
        description: "An error occurred whilst deleting the funnel.",
        variant: "destructive",
      });
    }
  };

  const handleRecompute = async (funnelId: string) => {
    try {
      await recomputeFunnel.mutateAsync({ configId, funnelId });
      toast({
        title: "Recompute queued",
        description: "Funnel results are being recomputed. This may take a moment.",
      });
    } catch {
      toast({
        title: "Failed to recompute",
        description: "An error occurred whilst queuing the recomputation.",
        variant: "destructive",
      });
    }
  };

  const handleToggleEnabled = async (funnelId: string, enabled: boolean) => {
    try {
      await updateFunnel.mutateAsync({
        configId,
        funnelId,
        data: { enabled },
      });
      toast({
        title: enabled ? "Funnel enabled" : "Funnel disabled",
        description: enabled
          ? "The funnel is now active and will be included in scheduled computations."
          : "The funnel has been disabled and will not be computed automatically.",
      });
    } catch {
      toast({
        title: "Failed to update funnel",
        description: "An error occurred whilst updating the funnel.",
        variant: "destructive",
      });
    }
  };

  const handleWindowChange = async (funnelId: string, days: number) => {
    try {
      await updateFunnel.mutateAsync({
        configId,
        funnelId,
        data: { analysisWindowDays: days },
      });
      toast({
        title: "Analysis window updated",
        description:
          "The analysis window has been changed. Recompute to see updated results.",
      });
    } catch {
      toast({
        title: "Failed to update window",
        description: "An error occurred whilst updating the analysis window.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-32" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-64" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Conversion Funnels
          </h3>
          <p className="text-sm text-muted-foreground">
            Define multi-step funnels and track conversion rates between each step.
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Funnel
        </Button>
      </div>

      {/* Funnel list */}
      {funnels && funnels.length > 0 ? (
        <div className="space-y-4">
          {funnels.map((funnel) => (
            <FunnelCard
              key={funnel.id}
              funnel={funnel}
              configId={configId}
              onDelete={handleDelete}
              onRecompute={handleRecompute}
              onToggleEnabled={handleToggleEnabled}
              onWindowChange={handleWindowChange}
              isDeleting={
                deleteFunnel.isPending &&
                deleteFunnel.variables?.funnelId === funnel.id
              }
              isRecomputing={
                recomputeFunnel.isPending &&
                recomputeFunnel.variables?.funnelId === funnel.id
              }
              isToggling={
                updateFunnel.isPending &&
                updateFunnel.variables?.funnelId === funnel.id &&
                updateFunnel.variables?.data?.enabled !== undefined
              }
              isUpdatingWindow={
                updateFunnel.isPending &&
                updateFunnel.variables?.funnelId === funnel.id &&
                updateFunnel.variables?.data?.analysisWindowDays !== undefined
              }
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <Filter className="h-10 w-10" />
            <p className="text-lg font-medium">No funnels defined</p>
            <p className="text-sm">
              Create a funnel to track how visitors progress through a
              series of steps on your site.
            </p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create your first funnel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <CreateFunnelDialog
        configId={configId}
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  );
}
