"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  useToast,
} from "@uni-proxy-manager/ui";
import { useMutation } from "@tanstack/react-query";

interface RuntimeCommandResult {
  nodeId: string;
  nodeName: string;
  success: boolean;
  output?: string;
  error?: string;
}

async function sendRuntimeCommand(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ command: string; results: RuntimeCommandResult[] }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error((data as { error?: string }).error ?? "Request failed");
  }
  return response.json();
}

export function ClusterRuntimePanel() {
  const { toast } = useToast();
  const [backendName, setBackendName] = useState("");
  const [serverName, setServerName] = useState("");
  const [weight, setWeight] = useState("100");
  const [maxconn, setMaxconn] = useState("0");
  const [lastResults, setLastResults] = useState<RuntimeCommandResult[] | null>(null);

  const runtimeMutation = useMutation({
    mutationFn: (args: { endpoint: string; body: Record<string, unknown> }) =>
      sendRuntimeCommand(args.endpoint, args.body),
    onSuccess: (data) => {
      setLastResults(data.results);
      const failed = data.results.filter((r) => !r.success).length;
      if (failed === 0) {
        toast({ title: "Command executed on all nodes" });
      } else {
        toast({
          title: `Command partially failed (${failed} node${failed > 1 ? "s" : ""} failed)`,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Runtime command failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const run = (endpoint: string, extra: Record<string, unknown> = {}) => {
    if (!backendName || !serverName) {
      toast({ title: "Backend name and server name are required", variant: "destructive" });
      return;
    }
    runtimeMutation.mutate({
      endpoint: `/api/cluster/runtime${endpoint}`,
      body: { backendName, serverName, ...extra },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Runtime Server Control</CardTitle>
        <CardDescription>
          Commands are fanned out to all cluster nodes simultaneously via the HAProxy stats socket.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="backendName">Backend Name</Label>
            <Input
              id="backendName"
              value={backendName}
              onChange={(e) => setBackendName(e.target.value)}
              placeholder="my_backend"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="serverName">Server Name</Label>
            <Input
              id="serverName"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="server1"
              className="mt-1"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => run("/server/enable")}
            disabled={runtimeMutation.isPending}
          >
            Enable
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run("/server/disable")}
            disabled={runtimeMutation.isPending}
          >
            Disable
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run("/server/drain")}
            disabled={runtimeMutation.isPending}
          >
            Drain
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="weight">Weight</Label>
            <div className="flex gap-2">
              <Input
                id="weight"
                type="number"
                min={0}
                max={256}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => run("/server/weight", { weight: parseInt(weight, 10) })}
                disabled={runtimeMutation.isPending}
              >
                Set
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="maxconn">Max Connections</Label>
            <div className="flex gap-2">
              <Input
                id="maxconn"
                type="number"
                min={0}
                value={maxconn}
                onChange={(e) => setMaxconn(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => run("/server/maxconn", { maxconn: parseInt(maxconn, 10) })}
                disabled={runtimeMutation.isPending}
              >
                Set
              </Button>
            </div>
          </div>
        </div>

        {lastResults && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Last command results:</p>
            {lastResults.map((r) => (
              <div
                key={r.nodeId}
                className={`rounded-md border px-3 py-2 text-xs ${
                  r.success
                    ? "border-border bg-muted/30"
                    : "border-destructive/40 bg-destructive/5 text-destructive"
                }`}
              >
                <span className="font-medium">{r.nodeName}</span>:{" "}
                {r.success ? r.output ?? "ok" : r.error ?? "failed"}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
