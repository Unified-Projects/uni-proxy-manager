"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FileUpload,
  useToast,
} from "@uni-proxy-manager/ui";
import { useUploadErrorPage } from "@/hooks/use-error-pages";
import type { ErrorPage } from "@/lib/types";

interface UploadErrorPageDialogProps {
  errorPage: ErrorPage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadErrorPageDialog({
  errorPage,
  open,
  onOpenChange,
}: UploadErrorPageDialogProps) {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const uploadErrorPage = useUploadErrorPage();

  const handleUpload = async () => {
    if (!errorPage || !selectedFile) return;

    try {
      await uploadErrorPage.mutateAsync({
        id: errorPage.id,
        file: selectedFile,
      });

      toast({
        title: "Files uploaded",
        description: `Error page files have been uploaded successfully.`,
      });

      setSelectedFile(null);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Upload failed",
        description:
          error instanceof Error ? error.message : "Failed to upload files",
        variant: "destructive",
      });
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setSelectedFile(null);
    }
    onOpenChange(open);
  };

  if (!errorPage) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Upload Error Page Files</DialogTitle>
          <DialogDescription>
            Upload a ZIP file containing your error page. The ZIP should contain
            an index.html file at the root or in a single subfolder.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <FileUpload
            onFileSelect={setSelectedFile}
            onFileRemove={() => setSelectedFile(null)}
            selectedFile={selectedFile}
            accept=".zip"
            maxSize={10 * 1024 * 1024}
            isLoading={uploadErrorPage.isPending}
          />

          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h4 className="font-medium mb-2">ZIP file requirements:</h4>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Must contain an index.html file</li>
              <li>Can include CSS, JS, and image files</li>
              <li>Maximum file size: 10MB</li>
              <li>All paths should be relative</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploadErrorPage.isPending}
          >
            {uploadErrorPage.isPending ? "Uploading..." : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
