"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
  Label,
  useToast,
} from "@uni-proxy-manager/ui";
import { useDeleteSite } from "@/hooks";
import type { Site } from "@/lib/types";

interface DeleteSiteDialogProps {
  site: Site;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteSiteDialog({
  site,
  open,
  onOpenChange,
}: DeleteSiteDialogProps) {
  const { toast } = useToast();
  const deleteSite = useDeleteSite();
  const [confirmName, setConfirmName] = useState("");

  const canDelete = confirmName === site.name;

  const handleDelete = async () => {
    try {
      await deleteSite.mutateAsync(site.id);
      toast({
        title: "Site deleted",
        description: `${site.name} has been deleted.`,
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Failed to delete site",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setConfirmName("");
    }
    onOpenChange(open);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Site</AlertDialogTitle>
          <AlertDialogDescription className="space-y-4">
            <p>
              This action cannot be undone. This will permanently delete the site{" "}
              <strong>{site.name}</strong> and all associated deployments.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="confirm-name">
                Type <strong>{site.name}</strong> to confirm
              </Label>
              <Input
                id="confirm-name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={site.name}
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={!canDelete || deleteSite.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteSite.isPending ? "Deleting..." : "Delete Site"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
