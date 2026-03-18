"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from "@uni-proxy-manager/ui";
import { useUpdateBypassIps } from "@/hooks/use-maintenance";
import type { Domain } from "@/lib/types";
import { Plus, X } from "lucide-react";

interface BypassIpsDialogProps {
  domain: Domain | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BypassIpsDialog({
  domain,
  open,
  onOpenChange,
}: BypassIpsDialogProps) {
  const { toast } = useToast();
  const [ips, setIps] = useState<string[]>([]);
  const [newIp, setNewIp] = useState("");
  const updateBypassIps = useUpdateBypassIps();

  useEffect(() => {
    if (domain && open) {
      setIps(domain.maintenanceBypassIps ?? []);
    }
  }, [domain, open]);

  const handleAddIp = () => {
    const trimmedIp = newIp.trim();
    if (!trimmedIp) return;

    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(trimmedIp)) {
      toast({
        title: "Invalid IP",
        description: "Please enter a valid IPv4 address.",
        variant: "destructive",
      });
      return;
    }

    if (ips.includes(trimmedIp)) {
      toast({
        title: "Duplicate IP",
        description: "This IP is already in the list.",
        variant: "destructive",
      });
      return;
    }

    setIps([...ips, trimmedIp]);
    setNewIp("");
  };

  const handleRemoveIp = (ip: string) => {
    setIps(ips.filter((i) => i !== ip));
  };

  const handleSave = async () => {
    if (!domain) return;

    try {
      await updateBypassIps.mutateAsync({
        domainId: domain.id,
        bypassIps: ips,
      });

      toast({
        title: "Bypass IPs updated",
        description: `Bypass IPs for ${domain.hostname} have been updated.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update bypass IPs",
        variant: "destructive",
      });
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setIps([]);
      setNewIp("");
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Manage Bypass IPs</DialogTitle>
          <DialogDescription>
            Manage IP addresses that can bypass maintenance mode for{" "}
            <strong>{domain?.hostname}</strong>. These IPs will see the live site even
            when maintenance is enabled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter IP address (e.g., 192.168.1.100)"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddIp();
                }
              }}
            />
            <Button type="button" variant="outline" size="icon" onClick={handleAddIp}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {ips.length > 0 ? (
            <div className="border rounded-lg divide-y">
              {ips.map((ip) => (
                <div key={ip} className="flex items-center justify-between p-3">
                  <code className="text-sm">{ip}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveIp(ip)}
                    className="text-destructive hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="border rounded-lg p-6 text-center text-muted-foreground">
              No bypass IPs configured. Add IP addresses to allow them to bypass
              maintenance mode.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateBypassIps.isPending}>
            {updateBypassIps.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
