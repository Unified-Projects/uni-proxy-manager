"use client";

import { useState } from "react";
import {
  Github,
  GitBranch,
  RefreshCw,
  Link2,
  Unlink,
  ExternalLink,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useToast,
} from "@uni-proxy-manager/ui";
import {
  useGitHubInstallUrl,
  useGitHubBranches,
  useUpdateGitHubConnection,
  useDisconnectGitHub,
  useSyncGitHub,
} from "@/hooks";
import type { GitHubConnection } from "@/lib/types";
import { ConnectGitHubDialog } from "./connect-github-dialog";

interface GitHubSettingsProps {
  siteId: string;
  connection: GitHubConnection | null | undefined;
}

export function GitHubSettings({ siteId, connection }: GitHubSettingsProps) {
  const { toast } = useToast();
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);

  const { data: installUrl } = useGitHubInstallUrl();
  const { data: branches } = useGitHubBranches(
    siteId,
    !!connection
  );
  const updateConnection = useUpdateGitHubConnection();
  const disconnectGitHub = useDisconnectGitHub();
  const syncGitHub = useSyncGitHub();

  const handleDisconnect = async () => {
    try {
      await disconnectGitHub.mutateAsync(siteId);
      toast({
        title: "GitHub disconnected",
        description: "Your repository has been disconnected.",
      });
    } catch (error) {
      toast({
        title: "Failed to disconnect",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleSync = async () => {
    try {
      await syncGitHub.mutateAsync(siteId);
      toast({
        title: "Sync started",
        description: "Syncing with your GitHub repository.",
      });
    } catch (error) {
      toast({
        title: "Sync failed",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleUpdateBranch = async (branch: string) => {
    try {
      await updateConnection.mutateAsync({
        siteId,
        data: { productionBranch: branch },
      });
      toast({
        title: "Branch updated",
        description: `Production branch set to ${branch}.`,
      });
    } catch (error) {
      toast({
        title: "Failed to update",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleToggleAutoDeploy = async (autoDeploy: boolean) => {
    try {
      await updateConnection.mutateAsync({
        siteId,
        data: { autoDeploy },
      });
      toast({
        title: autoDeploy ? "Auto-deploy enabled" : "Auto-deploy disabled",
        description: autoDeploy
          ? "New commits will trigger deployments automatically."
          : "You will need to trigger deployments manually.",
      });
    } catch (error) {
      toast({
        title: "Failed to update",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  if (!connection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub Integration
          </CardTitle>
          <CardDescription>
            Connect your GitHub repository for automatic deployments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center py-8">
            <Github className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">Not Connected</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Connect a GitHub repository to enable automatic deployments on push.
            </p>
            <Button onClick={() => setConnectDialogOpen(true)}>
              <Link2 className="mr-2 h-4 w-4" />
              Connect Repository
            </Button>
          </div>
        </CardContent>

        <ConnectGitHubDialog
          siteId={siteId}
          open={connectDialogOpen}
          onOpenChange={setConnectDialogOpen}
          installUrl={installUrl}
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              GitHub Integration
            </CardTitle>
            <CardDescription>
              Manage your GitHub repository connection
            </CardDescription>
          </div>
          <Badge className="bg-green-500/10 text-green-500">Connected</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-4 rounded-lg border">
          <div className="flex items-center gap-3">
            <Github className="h-8 w-8" />
            <div>
              <p className="font-medium">{connection.repositoryFullName}</p>
              {connection.repositoryUrl && (
                <a
                  href={connection.repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
                >
                  View on GitHub
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncGitHub.isPending}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${
                  syncGitHub.isPending ? "animate-spin" : ""
                }`}
              />
              Sync
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnectGitHub.isPending}
            >
              <Unlink className="mr-2 h-4 w-4" />
              Disconnect
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Production Branch</label>
            <Select
              value={connection.productionBranch || "main"}
              onValueChange={handleUpdateBranch}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {branches?.map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-3 w-3" />
                      {branch.name}
                      {branch.protected && (
                        <Badge variant="outline" className="text-xs">
                          protected
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                )) ?? (
                  <SelectItem value={connection.productionBranch || "main"}>
                    {connection.productionBranch || "main"}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Auto Deploy</p>
              <p className="text-sm text-muted-foreground">
                Deploy on push to production branch
              </p>
            </div>
            <Switch
              checked={connection.autoDeploy}
              onCheckedChange={handleToggleAutoDeploy}
              disabled={updateConnection.isPending}
            />
          </div>
        </div>

        {connection.lastSyncAt && (
          <p className="text-xs text-muted-foreground">
            Last synced: {new Date(connection.lastSyncAt).toLocaleString()}
            {connection.lastCommitSha && (
              <span className="ml-2 font-mono">
                ({connection.lastCommitSha.substring(0, 7)})
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
