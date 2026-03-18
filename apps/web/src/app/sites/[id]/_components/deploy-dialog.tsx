"use client";

import { useState, useRef } from "react";
import {
  Github,
  Upload,
  Rocket,
  FileArchive,
  Loader2,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  useToast,
} from "@uni-proxy-manager/ui";
import type { Site, GitHubConnection } from "@/lib/types";

interface DeployDialogProps {
  site: Site;
  githubConnection?: GitHubConnection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeployGitHub: () => Promise<void>;
  onDeployUpload: (file: File) => Promise<void>;
  isDeploying: boolean;
}

export function DeployDialog({
  site,
  githubConnection,
  open,
  onOpenChange,
  onDeployGitHub,
  onDeployUpload,
  isDeploying,
}: DeployDialogProps) {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deployMethod, setDeployMethod] = useState<"github" | "upload" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasGitHub = !!githubConnection;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".zip") && !file.name.endsWith(".tar.gz")) {
        toast({
          title: "Invalid file",
          description: "Please select a ZIP or tar.gz file",
          variant: "destructive",
        });
        return;
      }
      setSelectedFile(file);
      setDeployMethod("upload");
    }
  };

  const handleDeploy = async () => {
    if (deployMethod === "github") {
      await onDeployGitHub();
    } else if (deployMethod === "upload" && selectedFile) {
      await onDeployUpload(selectedFile);
    }
    onOpenChange(false);
    setSelectedFile(null);
    setDeployMethod(null);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setSelectedFile(null);
      setDeployMethod(null);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Deploy {site.name}</DialogTitle>
          <DialogDescription>
            Choose how you want to deploy your site
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {hasGitHub && (
            <button
              type="button"
              onClick={() => setDeployMethod("github")}
              className={`flex items-start gap-4 p-4 rounded-lg border-2 transition-all text-left ${
                deployMethod === "github"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              }`}
            >
              <div className="rounded-full bg-muted p-2">
                <Github className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Deploy from GitHub</p>
                <p className="text-sm text-muted-foreground">
                  Pull latest from {githubConnection?.repositoryFullName || "connected repository"}
                </p>
                {githubConnection?.productionBranch && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Branch: {githubConnection.productionBranch}
                  </p>
                )}
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setDeployMethod("upload");
              fileInputRef.current?.click();
            }}
            className={`flex items-start gap-4 p-4 rounded-lg border-2 transition-all text-left ${
              deployMethod === "upload"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <div className="rounded-full bg-muted p-2">
              <Upload className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="font-medium">Upload Archive</p>
              <p className="text-sm text-muted-foreground">
                Deploy by uploading a ZIP or tar.gz archive of your source code
              </p>
              {selectedFile && (
                <div className="flex items-center gap-2 mt-2 text-xs">
                  <FileArchive className="h-3 w-3" />
                  <span>{selectedFile.name}</span>
                  <span className="text-muted-foreground">
                    ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                </div>
              )}
            </div>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.tar.gz,application/gzip,application/x-gzip"
            onChange={handleFileChange}
            className="hidden"
          />

          {deployMethod === "upload" && !selectedFile && (
            <div className="text-center py-4 border-2 border-dashed rounded-lg">
              <Label
                htmlFor="file-upload"
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <FileArchive className="h-8 w-8 mx-auto mb-2" />
                <span>Click to select a ZIP or tar.gz file</span>
              </Label>
              <input
                id="file-upload"
                type="file"
                accept=".zip,.tar.gz,application/gzip,application/x-gzip"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={
              isDeploying ||
              !deployMethod ||
              (deployMethod === "upload" && !selectedFile)
            }
          >
            {isDeploying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Rocket className="mr-2 h-4 w-4" />
                Deploy
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
