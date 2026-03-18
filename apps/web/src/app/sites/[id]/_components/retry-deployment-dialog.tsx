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
import { useRetryDeployment } from "@/hooks";
import type { Deployment } from "@/lib/types";

interface RetryDeploymentDialogProps {
  deployment: Deployment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RetryDeploymentDialog({
  deployment,
  open,
  onOpenChange,
}: RetryDeploymentDialogProps) {
  const { toast } = useToast();
  const retryDeployment = useRetryDeployment();

  const handleRetry = async () => {
    try {
      await retryDeployment.mutateAsync(deployment.id);
      toast({
        title: "Deployment retry queued",
        description: `Retrying deployment #${deployment.version}...`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Failed to retry",
        description:
          error instanceof Error ? error.message : "Failed to retry deployment",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retry Deployment #{deployment.version}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will retry the failed deployment using the existing build artifact.
            The deployment will be queued and processed shortly.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRetry}
            disabled={retryDeployment.isPending}
          >
            {retryDeployment.isPending ? "Retrying..." : "Retry Deployment"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
