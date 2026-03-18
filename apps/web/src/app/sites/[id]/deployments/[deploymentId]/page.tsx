"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Rocket,
  Clock,
  GitCommit,
  GitBranch,
  XCircle,
  ArrowUpCircle,
  Loader2,
  Download,
  RefreshCw,
  RotateCw,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  useToast,
} from "@uni-proxy-manager/ui";
import {
  useDeployment,
  useCancelDeployment,
  usePromoteDeployment,
  useDeploymentLogs,
  useDeploymentLogsSSE,
} from "@/hooks";
import { DeleteDeploymentDialog } from "../../_components/delete-deployment-dialog";
import { RetryDeploymentDialog } from "../../_components/retry-deployment-dialog";
import { RedeployDeploymentDialog } from "../../_components/redeploy-deployment-dialog";

const statusColors: Record<string, string> = {
  pending: "bg-gray-500/10 text-gray-500",
  building: "bg-blue-500/10 text-blue-500",
  deploying: "bg-yellow-500/10 text-yellow-500",
  live: "bg-green-500/10 text-green-500",
  failed: "bg-red-500/10 text-red-500",
  rolled_back: "bg-orange-500/10 text-orange-500",
  cancelled: "bg-gray-500/10 text-gray-500",
};

interface DeploymentDetailPageProps {
  params: Promise<{ id: string; deploymentId: string }>;
}

export default function DeploymentDetailPage({
  params,
}: DeploymentDetailPageProps) {
  const { id: siteId, deploymentId } = use(params);
  const { toast } = useToast();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const router = useRouter();

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [redeployDialogOpen, setRedeployDialogOpen] = useState(false);

  const { data: deployment, isLoading } = useDeployment(deploymentId);

  // Determine if deployment is active (building/deploying)
  const isActiveDeployment = deployment?.status === "building" || deployment?.status === "deploying" || deployment?.status === "pending";

  // Use SSE for active deployments, polling for completed ones
  const sseLogs = useDeploymentLogsSSE(deploymentId, { enabled: isActiveDeployment });
  const { data: storedLogs } = useDeploymentLogs(deploymentId);

  const cancelDeployment = useCancelDeployment();
  const promoteDeployment = usePromoteDeployment();

  // Get current logs - prefer SSE for active, stored for completed
  const currentLogs = isActiveDeployment ? sseLogs.logs.join("\n") : (storedLogs?.logs || deployment?.buildLogs || "");

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [currentLogs, autoScroll]);

  const handleCancel = async () => {
    try {
      await cancelDeployment.mutateAsync(deploymentId);
      toast({
        title: "Deployment cancelled",
        description: "The deployment has been cancelled.",
      });
    } catch (error) {
      toast({
        title: "Failed to cancel",
        description:
          error instanceof Error ? error.message : "Failed to cancel deployment",
        variant: "destructive",
      });
    }
  };

  const handlePromote = async () => {
    try {
      await promoteDeployment.mutateAsync(deploymentId);
      toast({
        title: "Deployment promoted",
        description: "The deployment has been promoted to production.",
      });
    } catch (error) {
      toast({
        title: "Failed to promote",
        description:
          error instanceof Error
            ? error.message
            : "Failed to promote deployment",
        variant: "destructive",
      });
    }
  };

  const handleDeleteSuccess = () => {
    router.push(`/sites/${siteId}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-2xl font-bold">Deployment not found</h2>
        <p className="text-muted-foreground">
          The deployment you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/sites/${siteId}`}>Back to Site</Link>
        </Button>
      </div>
    );
  }

  const isInProgress =
    deployment.status === "building" || deployment.status === "deploying";
  const canPromote =
    deployment.status === "live" && !deployment.isActive;
  const canRetry = deployment.status === "failed" && !!deployment.artifactPath;
  const canRedeploy =
    !!deployment.artifactPath &&
    !isInProgress &&
    !["failed", "pending"].includes(deployment.status);
  const canDelete =
    !deployment.isActive &&
    !["pending", "building", "deploying"].includes(deployment.status);
  const buildDuration = deployment.buildDurationMs
    ? Math.round(deployment.buildDurationMs / 1000)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/sites/${siteId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Rocket className="h-6 w-6" />
              <h1 className="text-3xl font-bold">
                Deployment #{deployment.version}
              </h1>
              <Badge
                className={statusColors[deployment.status] || statusColors.pending}
              >
                {deployment.status}
              </Badge>
              {deployment.isActive && (
                <Badge className="bg-green-500 text-white">Active</Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              Triggered by {deployment.triggeredBy} on{" "}
              {new Date(deployment.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isInProgress && (
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelDeployment.isPending}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          )}
          {canPromote && (
            <Button onClick={handlePromote} disabled={promoteDeployment.isPending}>
              <ArrowUpCircle className="mr-2 h-4 w-4" />
              Promote to Production
            </Button>
          )}
          {canRetry && (
            <Button variant="outline" onClick={() => setRetryDialogOpen(true)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          )}
          {canRedeploy && (
            <Button variant="outline" onClick={() => setRedeployDialogOpen(true)}>
              <RotateCw className="mr-2 h-4 w-4" />
              Redeploy Build
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Branch</CardTitle>
            <GitBranch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{deployment.branch || "-"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Commit</CardTitle>
            <GitCommit className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-mono">
              {deployment.commitSha?.substring(0, 7) || "-"}
            </div>
            {deployment.commitMessage && (
              <p className="text-xs text-muted-foreground truncate mt-1">
                {deployment.commitMessage}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Build Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {buildDuration ? `${buildDuration}s` : "-"}
            </div>
            {deployment.buildStartedAt && (
              <p className="text-xs text-muted-foreground">
                Started {new Date(deployment.buildStartedAt).toLocaleTimeString()}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Slot</CardTitle>
            <Download className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {deployment.slot || "-"}
            </div>
            {deployment.artifactSize && (
              <p className="text-xs text-muted-foreground">
                {(deployment.artifactSize / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Build Logs
              {isInProgress && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </CardTitle>
            <CardDescription>
              Real-time build and deployment logs
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            Auto-scroll: {autoScroll ? "On" : "Off"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="bg-slate-950 text-slate-50 font-mono text-sm p-4 rounded-lg h-[500px] overflow-auto">
            {currentLogs ? (
              <>
                <pre className="whitespace-pre-wrap">{currentLogs}</pre>
                <div ref={logsEndRef} />
              </>
            ) : isInProgress ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {sseLogs.isConnected ? "Streaming logs..." : sseLogs.error || "Connecting..."}
              </div>
            ) : (
              <span className="text-muted-foreground">No logs available</span>
            )}
          </div>
          {sseLogs.error && isActiveDeployment && (
            <div className="mt-2 text-sm text-yellow-500">
              {sseLogs.error}
            </div>
          )}
          {deployment.errorMessage && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-500 font-medium">Error</p>
              <p className="text-sm text-red-400 mt-1">
                {deployment.errorMessage}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <DeleteDeploymentDialog
        deployment={deployment}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onSuccess={handleDeleteSuccess}
      />
      <RetryDeploymentDialog
        deployment={deployment}
        open={retryDialogOpen}
        onOpenChange={setRetryDialogOpen}
      />
      <RedeployDeploymentDialog
        deployment={deployment}
        open={redeployDialogOpen}
        onOpenChange={setRedeployDialogOpen}
      />
    </div>
  );
}
