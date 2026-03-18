"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Github,
  Upload,
  Clock,
  ExternalLink,
  Loader2,
  XCircle,
  ArrowUpCircle,
  RefreshCw,
  RotateCw,
  Trash2,
  HelpCircle,
  CalendarClock,
} from "lucide-react";
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from "@uni-proxy-manager/ui";
import {
  useCancelDeployment,
  usePromoteDeployment,
} from "@/hooks";
import type { Deployment } from "@/lib/types";
import { DeleteDeploymentDialog } from "./delete-deployment-dialog";
import { RetryDeploymentDialog } from "./retry-deployment-dialog";
import { RedeployDeploymentDialog } from "./redeploy-deployment-dialog";

const statusColors: Record<string, string> = {
  pending: "bg-gray-500/10 text-gray-500",
  building: "bg-blue-500/10 text-blue-500",
  deploying: "bg-yellow-500/10 text-yellow-500",
  live: "bg-green-500/10 text-green-500",
  failed: "bg-red-500/10 text-red-500",
  rolled_back: "bg-orange-500/10 text-orange-500",
  cancelled: "bg-gray-500/10 text-gray-500",
};

function getMethodIcon(triggeredBy: string) {
  switch (triggeredBy) {
    case "webhook":
      return <Github className="h-4 w-4" />;
    case "manual":
      return <Github className="h-4 w-4" />;
    case "upload":
      return <Upload className="h-4 w-4" />;
    case "schedule":
      return <CalendarClock className="h-4 w-4" />;
    case "rollback":
      return <RotateCw className="h-4 w-4" />;
    default:
      return <HelpCircle className="h-4 w-4" />;
  }
}

function getMethodTooltip(deployment: { triggeredBy: string; branch?: string | null; commitSha?: string | null; version: number }): string {
  switch (deployment.triggeredBy) {
    case "webhook":
      return `GitHub webhook${deployment.branch ? ` - ${deployment.branch}` : ""}${deployment.commitSha ? ` (${deployment.commitSha.substring(0, 7)})` : ""}`;
    case "manual":
      return `Git sync${deployment.branch ? ` - ${deployment.branch}` : ""}${deployment.commitSha ? ` (${deployment.commitSha.substring(0, 7)})` : ""}`;
    case "upload":
      return "Manual file upload";
    case "schedule":
      return "Scheduled deployment";
    case "rollback":
      return `Rollback to v${deployment.version}`;
    default:
      return "Unknown trigger";
  }
}

interface DeploymentListProps {
  siteId: string;
  deployments: Deployment[];
}

export function DeploymentList({ siteId, deployments }: DeploymentListProps) {
  const { toast } = useToast();
  const cancelDeployment = useCancelDeployment();
  const promoteDeployment = usePromoteDeployment();

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [redeployDialogOpen, setRedeployDialogOpen] = useState(false);
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(null);

  // Sort deployments by createdAt descending (newest first)
  const sortedDeployments = useMemo(() => {
    return [...deployments].sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [deployments]);

  const handleCancel = async (deploymentId: string) => {
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

  const handlePromote = async (deploymentId: string, version: number) => {
    try {
      await promoteDeployment.mutateAsync(deploymentId);
      toast({
        title: "Deployment promoted",
        description: `Deployment #${version} is now active.`,
      });
    } catch (error) {
      toast({
        title: "Failed to promote",
        description:
          error instanceof Error ? error.message : "Failed to promote deployment",
        variant: "destructive",
      });
    }
  };

  const openRetryDialog = (deployment: Deployment) => {
    setSelectedDeployment(deployment);
    setRetryDialogOpen(true);
  };

  const openRedeployDialog = (deployment: Deployment) => {
    setSelectedDeployment(deployment);
    setRedeployDialogOpen(true);
  };

  const openDeleteDialog = (deployment: Deployment) => {
    setSelectedDeployment(deployment);
    setDeleteDialogOpen(true);
  };

  if (deployments.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No deployments yet. Trigger a deployment to get started.
      </div>
    );
  }

  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Version</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Deployed</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedDeployments.map((deployment) => {
          const isInProgress =
            deployment.status === "building" ||
            deployment.status === "deploying";
          const canPromote =
            deployment.status === "live" && !deployment.isActive;
          const canCancel = isInProgress;
          const canRetry = deployment.status === "failed" && !!deployment.artifactPath;
          const canRedeploy =
            !!deployment.artifactPath &&
            !isInProgress &&
            !["failed", "pending"].includes(deployment.status);
          const canDelete =
            !deployment.isActive &&
            !["pending", "building", "deploying"].includes(deployment.status);

          return (
            <TableRow
              key={deployment.id}
              className={deployment.isActive ? "bg-green-500/5" : ""}
            >
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">#{deployment.version}</span>
                  {deployment.isActive && (
                    <Badge className="bg-green-500 text-white text-xs">
                      Active
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  className={
                    statusColors[deployment.status] || statusColors.pending
                  }
                >
                  {isInProgress && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  {deployment.status}
                </Badge>
              </TableCell>
              <TableCell>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 cursor-help">
                        {getMethodIcon(deployment.triggeredBy)}
                        {(deployment.triggeredBy === "webhook" || deployment.triggeredBy === "manual") && deployment.branch && (
                          <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                            {deployment.branch}
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{getMethodTooltip(deployment)}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableCell>
              <TableCell>
                {deployment.buildDurationMs ? (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span>
                      {Math.round(deployment.buildDurationMs / 1000)}s
                    </span>
                  </div>
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell>
                {deployment.deployedAt
                  ? new Date(deployment.deployedAt).toLocaleDateString()
                  : "-"}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {canCancel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancel(deployment.id)}
                      disabled={cancelDeployment.isPending}
                      className="text-red-500 hover:text-red-600"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                  {canPromote && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePromote(deployment.id, deployment.version)}
                      disabled={promoteDeployment.isPending}
                      className="text-green-500 hover:text-green-600"
                      title="Set as active"
                    >
                      <ArrowUpCircle className="h-4 w-4" />
                    </Button>
                  )}
                  {canRetry && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openRetryDialog(deployment)}
                      className="text-yellow-500 hover:text-yellow-600"
                      title="Retry deployment"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}
                  {canRedeploy && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openRedeployDialog(deployment)}
                      className="text-blue-500 hover:text-blue-600"
                      title="Redeploy build"
                    >
                      <RotateCw className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDeleteDialog(deployment)}
                      className="text-red-500 hover:text-red-600"
                      title="Delete deployment"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/sites/${siteId}/deployments/${deployment.id}`}>
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>

    {selectedDeployment && (
      <>
        <DeleteDeploymentDialog
          deployment={selectedDeployment}
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
        />
        <RetryDeploymentDialog
          deployment={selectedDeployment}
          open={retryDialogOpen}
          onOpenChange={setRetryDialogOpen}
        />
        <RedeployDeploymentDialog
          deployment={selectedDeployment}
          open={redeployDialogOpen}
          onOpenChange={setRedeployDialogOpen}
        />
      </>
    )}
    </>
  );
}
