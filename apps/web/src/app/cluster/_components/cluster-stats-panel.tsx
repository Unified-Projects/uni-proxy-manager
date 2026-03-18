"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@uni-proxy-manager/ui";
import { RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface NodeStatsResult {
  nodeId: string;
  nodeName: string;
  success: boolean;
  info?: Record<string, string | number>;
  stats?: unknown;
  error?: string;
}

async function fetchClusterInfo(): Promise<{ nodes: NodeStatsResult[] }> {
  const response = await fetch("/api/cluster/runtime/info", { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch cluster info");
  return response.json();
}

export function ClusterStatsPanel() {
  const [enabled, setEnabled] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["cluster-runtime-info"],
    queryFn: fetchClusterInfo,
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cluster Info</CardTitle>
        <CardDescription>
          Aggregated HAProxy info from all registered cluster nodes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          {!enabled ? (
            <Button size="sm" variant="outline" onClick={() => setEnabled(true)}>
              Load Info
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          )}
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

        {data?.nodes.map((node) => (
          <div key={node.nodeId} className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">{node.nodeName}</span>
              {node.success ? (
                <span className="text-xs text-green-600 dark:text-green-400">OK</span>
              ) : (
                <span className="text-xs text-destructive">Error</span>
              )}
            </div>
            <div className="px-3 py-2">
              {node.success && node.info ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {Object.entries(node.info)
                    .filter(([k]) => k !== "raw")
                    .slice(0, 12)
                    .map(([key, val]) => (
                      <div key={key} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="font-mono font-medium">{String(val)}</span>
                      </div>
                    ))}
                  {node.info.raw && (
                    <div className="col-span-2 mt-1">
                      <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                        {String(node.info.raw)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-destructive">{node.error ?? "No data"}</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
