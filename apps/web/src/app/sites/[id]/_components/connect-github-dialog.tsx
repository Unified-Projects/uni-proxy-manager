"use client";

import { useState } from "react";
import { Github, ExternalLink, Search, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  useToast,
} from "@uni-proxy-manager/ui";
import { useGitHubRepositories, useConnectGitHub } from "@/hooks";
import type { GitHubRepository } from "@/lib/types";

interface ConnectGitHubDialogProps {
  siteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installUrl?: string;
  installationId?: number;
}

export function ConnectGitHubDialog({
  siteId,
  open,
  onOpenChange,
  installUrl,
  installationId,
}: ConnectGitHubDialogProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null);

  const { data: repositories, isLoading } = useGitHubRepositories(installationId);
  const connectGitHub = useConnectGitHub();

  const filteredRepos = repositories?.filter((repo) =>
    repo.fullName.toLowerCase().includes(search.toLowerCase())
  );

  const handleConnect = async () => {
    if (!selectedRepo) return;

    try {
      await connectGitHub.mutateAsync({
        siteId,
        data: {
          installationId: 0, // Will be filled by backend from GitHub App
          repositoryId: selectedRepo.id,
          repositoryFullName: selectedRepo.fullName,
          repositoryUrl: selectedRepo.url,
          productionBranch: selectedRepo.defaultBranch,
          autoDeploy: true,
        },
      });

      toast({
        title: "Repository connected",
        description: `${selectedRepo.fullName} has been connected.`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Failed to connect",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSearch("");
      setSelectedRepo(null);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Connect GitHub Repository
          </DialogTitle>
          <DialogDescription>
            Select a repository to connect for automatic deployments
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {repositories && repositories.length > 0 ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search repositories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              <ScrollArea className="h-[300px] rounded-md border">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredRepos && filteredRepos.length > 0 ? (
                  <div className="divide-y">
                    {filteredRepos.map((repo) => (
                      <button
                        key={repo.id}
                        className={`w-full p-3 text-left hover:bg-muted transition-colors ${
                          selectedRepo?.id === repo.id ? "bg-muted" : ""
                        }`}
                        onClick={() => setSelectedRepo(repo)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{repo.fullName}</p>
                            <p className="text-sm text-muted-foreground">
                              {repo.private ? "Private" : "Public"} - {repo.defaultBranch}
                            </p>
                          </div>
                          {selectedRepo?.id === repo.id && (
                            <div className="h-4 w-4 rounded-full bg-primary" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No repositories found
                  </div>
                )}
              </ScrollArea>
            </>
          ) : (
            <div className="text-center py-8">
              <Github className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">Install GitHub App</h3>
              <p className="text-sm text-muted-foreground mb-4">
                You need to install the GitHub App to connect repositories.
              </p>
              {installUrl && (
                <Button asChild>
                  <a href={installUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Install GitHub App
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConnect}
            disabled={!selectedRepo || connectGitHub.isPending}
          >
            {connectGitHub.isPending ? "Connecting..." : "Connect Repository"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
