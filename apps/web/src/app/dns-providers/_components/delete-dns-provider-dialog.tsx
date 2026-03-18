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
import { useDeleteDnsProvider } from "@/hooks/use-dns-providers";
import type { DnsProvider } from "@/lib/types";

interface DeleteDnsProviderDialogProps {
  provider: DnsProvider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteDnsProviderDialog({
  provider,
  open,
  onOpenChange,
}: DeleteDnsProviderDialogProps) {
  const { toast } = useToast();
  const deleteProvider = useDeleteDnsProvider();

  const handleDelete = async () => {
    if (!provider) return;

    try {
      await deleteProvider.mutateAsync(provider.id);

      toast({
        title: "Provider deleted",
        description: `${provider.name} has been deleted.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete provider",
        variant: "destructive",
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete DNS Provider</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-semibold">{provider?.name}</span>?
            <br />
            <br />
            Certificates using this provider will need to be reassigned to
            another provider before renewal.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteProvider.isPending ? "Deleting..." : "Delete Provider"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
