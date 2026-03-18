"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  useToast,
} from "@uni-proxy-manager/ui";
import { useRedeployDeployment } from "@/hooks";
import type { Deployment } from "@/lib/types";

interface RedeployDeploymentDialogProps {
  deployment: Deployment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RedeployDeploymentDialog({
  deployment,
  open,
  onOpenChange,
}: RedeployDeploymentDialogProps) {
  const { toast } = useToast();
  const redeployDeployment = useRedeployDeployment();

  const handleRedeploy = async () => {
    try {
      await redeployDeployment.mutateAsync(deployment.id);
      toast({
        title: "Redeploy queued",
        description: `Creating new deployment from build #${deployment.version}...`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Failed to redeploy",
        description:
          error instanceof Error ? error.message : "Failed to redeploy",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Redeploy from #{deployment.version}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will create a new deployment using the cached build artifact from
            deployment #{deployment.version}. No rebuild will be required.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRedeploy}
            disabled={redeployDeployment.isPending}
          >
            {redeployDeployment.isPending ? "Redeploying..." : "Redeploy"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
