"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useToast,
} from "@uni-proxy-manager/ui";
import { MoreHorizontal, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import {
  useDeleteClusterNode,
  useSyncClusterNode,
  useCheckClusterNodeStatus,
} from "@/hooks/use-cluster";
import type { ClusterNode, ClusterNodeStatus } from "@/lib/types";

function StatusBadge({ status }: { status: ClusterNodeStatus }) {
  const variants: Record<ClusterNodeStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    online: { label: "Online", variant: "default" },
    offline: { label: "Offline", variant: "destructive" },
    syncing: { label: "Syncing", variant: "secondary" },
    error: { label: "Error", variant: "destructive" },
    unknown: { label: "Unknown", variant: "outline" },
  };
  const { label, variant } = variants[status] ?? variants.unknown;
  return <Badge variant={variant}>{label}</Badge>;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface ClusterNodesTableProps {
  nodes: ClusterNode[];
}

export function ClusterNodesTable({ nodes }: ClusterNodesTableProps) {
  const { toast } = useToast();
  const deleteNode = useDeleteClusterNode();
  const syncNode = useSyncClusterNode();
  const checkStatus = useCheckClusterNodeStatus();
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const handleSync = async (id: string, name: string) => {
    try {
      await syncNode.mutateAsync(id);
      toast({ title: `Sync queued for ${name}` });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to queue sync",
        variant: "destructive",
      });
    }
  };

  const handleCheckStatus = async (id: string) => {
    setCheckingId(id);
    try {
      const result = await checkStatus.mutateAsync(id);
      toast({
        title: `Node is ${result.status}`,
        description: result.error ?? undefined,
        variant: result.status === "online" ? "default" : "destructive",
      });
    } catch (error) {
      toast({
        title: "Status check failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCheckingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove node "${name}" from the cluster?`)) return;
    try {
      await deleteNode.mutateAsync(id);
      toast({ title: `Node "${name}" removed` });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to remove node",
        variant: "destructive",
      });
    }
  };

  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">
          No cluster nodes registered. Add a node to enable multi-instance sync.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Name</th>
            <th className="px-4 py-3 text-left font-medium">API URL</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Last Seen</th>
            <th className="px-4 py-3 text-left font-medium">Last Sync</th>
            <th className="px-4 py-3 text-left font-medium">Config Version</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">
                {node.name}
                {node.isLocal && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    local
                  </span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{node.apiUrl}</td>
              <td className="px-4 py-3">
                <StatusBadge status={node.status} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatRelativeTime(node.lastSeenAt)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {node.lastSyncError ? (
                  <span
                    className="text-destructive cursor-help"
                    title={node.lastSyncError}
                  >
                    {formatRelativeTime(node.lastSyncAt)} (error)
                  </span>
                ) : (
                  formatRelativeTime(node.lastSyncAt)
                )}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {node.configVersion ?? "—"}
              </td>
              <td className="px-4 py-3 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleCheckStatus(node.id)}
                      disabled={checkingId === node.id}
                    >
                      {node.status === "online" ? (
                        <Wifi className="mr-2 h-4 w-4" />
                      ) : (
                        <WifiOff className="mr-2 h-4 w-4" />
                      )}
                      Check Status
                    </DropdownMenuItem>
                    {!node.isLocal && (
                      <DropdownMenuItem
                        onClick={() => handleSync(node.id, node.name)}
                        disabled={syncNode.isPending}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Force Sync
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => handleDelete(node.id, node.name)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
