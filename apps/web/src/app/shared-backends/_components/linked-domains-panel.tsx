"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@uni-proxy-manager/ui";
import { Trash2, Link } from "lucide-react";
import { useDomains } from "@/hooks/use-domains";
import { useLinkDomainToSharedBackend, useUnlinkDomainFromSharedBackend, useSharedBackend } from "@/hooks/use-shared-backends";
import type { SharedBackend } from "@/lib/types";

interface LinkedDomainsPanelProps {
  backend: SharedBackend;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LinkedDomainsPanel({
  backend,
  open,
  onOpenChange,
}: LinkedDomainsPanelProps) {
  const { toast } = useToast();
  const [selectedDomainId, setSelectedDomainId] = useState<string>("");

  const { data: backendDetail, isLoading } = useSharedBackend(open ? backend.id : "");
  const { data: allDomains } = useDomains();
  const linkDomain = useLinkDomainToSharedBackend();
  const unlinkDomain = useUnlinkDomainFromSharedBackend();

  const linkedDomains = backendDetail?.linkedDomains ?? [];
  const linkedDomainIds = new Set(linkedDomains.map((d) => d.id));

  const availableDomains = (allDomains ?? []).filter((d) => !linkedDomainIds.has(d.id));

  const handleLink = async () => {
    if (!selectedDomainId) return;
    try {
      await linkDomain.mutateAsync({ id: backend.id, domainId: selectedDomainId });
      toast({ title: "Domain linked to shared backend" });
      setSelectedDomainId("");
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to link domain",
        variant: "destructive",
      });
    }
  };

  const handleUnlink = async (domainId: string) => {
    try {
      await unlinkDomain.mutateAsync({ id: backend.id, domainId });
      toast({ title: "Domain unlinked" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to unlink domain",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Linked Domains — {backend.name}</DialogTitle>
          <DialogDescription>
            Domains that receive this shared backend in their HAProxy config.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Select value={selectedDomainId} onValueChange={setSelectedDomainId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select domain to link..." />
              </SelectTrigger>
              <SelectContent>
                {availableDomains.length === 0 ? (
                  <SelectItem value="" disabled>No unlinked domains available</SelectItem>
                ) : (
                  availableDomains.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.hostname}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              onClick={handleLink}
              disabled={!selectedDomainId || linkDomain.isPending}
              size="sm"
            >
              <Link className="mr-1 h-4 w-4" />
              Link
            </Button>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading linked domains...</p>
          ) : linkedDomains.length === 0 ? (
            <p className="text-sm text-muted-foreground">No domains linked yet.</p>
          ) : (
            <div className="space-y-2">
              {linkedDomains.map((domain) => (
                <div
                  key={domain.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm font-medium">{domain.hostname}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleUnlink(domain.id)}
                    disabled={unlinkDomain.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
