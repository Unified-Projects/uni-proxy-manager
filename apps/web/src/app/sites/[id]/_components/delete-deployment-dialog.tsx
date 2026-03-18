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
import { useDeleteDeployment } from "@/hooks";
import type { Deployment } from "@/lib/types";

interface DeleteDeploymentDialogProps {
  deployment: Deployment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function DeleteDeploymentDialog({
  deployment,
  open,
  onOpenChange,
  onSuccess,
}: DeleteDeploymentDialogProps) {
  const { toast } = useToast();
  const deleteDeployment = useDeleteDeployment();

  const handleDelete = async () => {
    try {
      await deleteDeployment.mutateAsync(deployment.id);
      toast({
        title: "Deployment deleted",
        description: `Deployment #${deployment.version} has been removed.`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Failed to delete",
        description:
          error instanceof Error ? error.message : "Failed to delete deployment",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Deployment #{deployment.version}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the deployment and its associated artifacts.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteDeployment.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteDeployment.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
