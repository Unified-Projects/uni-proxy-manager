"use client";

import { useState } from "react";
import { GitCommit, GitBranch, Clock, RotateCcw } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  useToast,
} from "@uni-proxy-manager/ui";
import { useRollbackSite } from "@/hooks";
import type { Site, Deployment } from "@/lib/types";

interface RollbackDialogProps {
  site: Site;
  deployments: Deployment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RollbackDialog({
  site,
  deployments,
  open,
  onOpenChange,
}: RollbackDialogProps) {
  const { toast } = useToast();
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(null);
  const rollbackSite = useRollbackSite();

  const eligibleDeployments = deployments.filter(
    (d) => d.status === "live" && !d.isActive
  );

  const handleRollback = async () => {
    if (!selectedDeployment) return;

    try {
      await rollbackSite.mutateAsync({
        siteId: site.id,
        deploymentId: selectedDeployment.id,
      });

      toast({
        title: "Rollback initiated",
        description: `Rolling back to deployment #${selectedDeployment.version}.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Rollback failed",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedDeployment(null);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Rollback Deployment
          </DialogTitle>
          <DialogDescription>
            Select a previous deployment to rollback to
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {eligibleDeployments.length > 0 ? (
            <ScrollArea className="h-[300px] rounded-md border">
              <div className="divide-y">
                {eligibleDeployments.map((deployment) => (
                  <button
                    key={deployment.id}
                    className={`w-full p-4 text-left hover:bg-muted transition-colors ${
                      selectedDeployment?.id === deployment.id ? "bg-muted" : ""
                    }`}
                    onClick={() => setSelectedDeployment(deployment)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            Deployment #{deployment.version}
                          </span>
                          <Badge className="bg-green-500/10 text-green-500">
                            {deployment.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {deployment.branch && (
                            <div className="flex items-center gap-1">
                              <GitBranch className="h-3 w-3" />
                              {deployment.branch}
                            </div>
                          )}
                          {deployment.commitSha && (
                            <div className="flex items-center gap-1">
                              <GitCommit className="h-3 w-3" />
                              <code className="text-xs">
                                {deployment.commitSha.substring(0, 7)}
                              </code>
                            </div>
                          )}
                          {deployment.deployedAt && (
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(deployment.deployedAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                        {deployment.commitMessage && (
                          <p className="text-sm text-muted-foreground truncate mt-1">
                            {deployment.commitMessage}
                          </p>
                        )}
                      </div>
                      {selectedDeployment?.id === deployment.id && (
                        <div className="h-4 w-4 rounded-full bg-primary" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No previous deployments available for rollback
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRollback}
            disabled={!selectedDeployment || rollbackSite.isPending}
          >
            {rollbackSite.isPending ? "Rolling back..." : "Rollback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
