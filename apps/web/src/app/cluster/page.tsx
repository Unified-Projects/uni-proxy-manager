"use client";

import { useState } from "react";
import { Button } from "@uni-proxy-manager/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useClusterNodes, useSyncAllClusterNodes } from "@/hooks/use-cluster";
import { ClusterNodesTable } from "./_components/cluster-nodes-table";
import { AddNodeDialog } from "./_components/add-node-dialog";
import { ClusterRuntimePanel } from "./_components/cluster-runtime-panel";
import { ClusterStatsPanel } from "./_components/cluster-stats-panel";
import { useToast } from "@uni-proxy-manager/ui";

export default function ClusterPage() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const { data: nodes, isLoading, refetch, isFetching } = useClusterNodes();
  const syncAll = useSyncAllClusterNodes();

  const handleSyncAll = async () => {
    try {
      const result = await syncAll.mutateAsync();
      if (result.nodesQueued === 0) {
        toast({ title: "No remote nodes to sync" });
      } else {
        toast({ title: `Sync queued for ${result.nodesQueued} node${result.nodesQueued > 1 ? "s" : ""}` });
      }
    } catch (error) {
      toast({
        title: "Sync-all failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cluster</h1>
          <p className="text-muted-foreground">
            Manage HAProxy nodes and synchronise configuration across your cluster.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAll}
            disabled={syncAll.isPending}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Sync All
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Node
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading nodes...</p>
      ) : (
        <ClusterNodesTable nodes={nodes ?? []} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ClusterRuntimePanel />
        <ClusterStatsPanel />
      </div>

      <AddNodeDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
