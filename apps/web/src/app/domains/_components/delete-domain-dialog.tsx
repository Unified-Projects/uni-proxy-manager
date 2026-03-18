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
import { useDeleteDomain } from "@/hooks/use-domains";
import type { Domain } from "@/lib/types";

interface DeleteDomainDialogProps {
  domain: Domain | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteDomainDialog({
  domain,
  open,
  onOpenChange,
}: DeleteDomainDialogProps) {
  const { toast } = useToast();
  const deleteDomain = useDeleteDomain();

  const handleDelete = async () => {
    if (!domain) return;

    try {
      await deleteDomain.mutateAsync(domain.id);

      toast({
        title: "Domain deleted",
        description: `${domain.hostname} has been deleted successfully.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete domain",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Domain</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-semibold">{domain?.hostname}</span>? This
            action cannot be undone.
            <br />
            <br />
            This will also delete:
            <ul className="mt-2 list-inside list-disc">
              <li>All backend configurations</li>
              <li>Associated SSL certificates</li>
              <li>Maintenance history</li>
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteDomain.isPending ? "Deleting..." : "Delete Domain"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
