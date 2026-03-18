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
import { useCancelMaintenanceWindow, useDisableMaintenance } from "@/hooks/use-maintenance";
import type { MaintenanceWindow } from "@/lib/types";

interface CancelMaintenanceDialogProps {
  maintenanceWindow: MaintenanceWindow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelMaintenanceDialog({
  maintenanceWindow,
  open,
  onOpenChange,
}: CancelMaintenanceDialogProps) {
  const { toast } = useToast();
  const cancelWindow = useCancelMaintenanceWindow();
  const disableMaintenance = useDisableMaintenance();

  const handleCancel = async () => {
    if (!maintenanceWindow) return;

    try {
      // If the window is active, we need to disable maintenance on the domain
      if (maintenanceWindow.isActive && maintenanceWindow.domainId) {
        await disableMaintenance.mutateAsync(maintenanceWindow.domainId);
      }

      // Cancel the maintenance window
      await cancelWindow.mutateAsync(maintenanceWindow.id);

      toast({
        title: maintenanceWindow.isActive ? "Maintenance ended" : "Maintenance cancelled",
        description: maintenanceWindow.isActive
          ? "The maintenance window has been ended and the domain is back online."
          : "The scheduled maintenance window has been cancelled.",
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to cancel maintenance",
        variant: "destructive",
      });
    }
  };

  const isActive = maintenanceWindow?.isActive;
  const isPending = cancelWindow.isPending || disableMaintenance.isPending;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isActive ? "End Maintenance" : "Cancel Scheduled Maintenance"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isActive ? (
              <>
                Are you sure you want to end the current maintenance window for{" "}
                <span className="font-semibold">{maintenanceWindow?.domain?.hostname}</span>?
                <br />
                <br />
                The domain will be brought back online immediately.
              </>
            ) : (
              <>
                Are you sure you want to cancel the scheduled maintenance for{" "}
                <span className="font-semibold">{maintenanceWindow?.domain?.hostname}</span>?
                <br />
                <br />
                This action cannot be undone. You will need to schedule a new maintenance
                window if needed.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Maintenance</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancel}
            className={
              isActive
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            }
          >
            {isPending
              ? isActive
                ? "Ending..."
                : "Cancelling..."
              : isActive
                ? "End Maintenance"
                : "Cancel Maintenance"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
