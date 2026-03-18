"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, FileArchive, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@uni-proxy-manager/ui";
import { useUploadMaintenancePageFiles } from "@/hooks/use-maintenance-pages";
import type { ErrorPage } from "@/lib/types";

interface UploadMaintenancePageDialogProps {
  maintenancePage: ErrorPage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadMaintenancePageDialog({
  maintenancePage,
  open,
  onOpenChange,
}: UploadMaintenancePageDialogProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const uploadFiles = useUploadMaintenancePageFiles();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/zip": [".zip"],
    },
    maxFiles: 1,
  });

  const handleUpload = async () => {
    if (!maintenancePage || !file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      await uploadFiles.mutateAsync({
        id: maintenancePage.id,
        formData,
      });

      toast({
        title: "Files uploaded",
        description: "Your maintenance page files have been uploaded successfully.",
      });

      setFile(null);
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

  const handleClose = () => {
    setFile(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {maintenancePage?.uploadedAt ? "Replace" : "Upload"} Maintenance Page Files
          </DialogTitle>
          <DialogDescription>
            Upload a ZIP file containing your maintenance page HTML, CSS, and assets.
            The ZIP should contain an index.html file at the root or in a single subdirectory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"}
              ${file ? "bg-muted/50" : "hover:border-primary hover:bg-primary/5"}
            `}
          >
            <input {...getInputProps()} />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileArchive className="h-8 w-8 text-primary" />
                <div className="text-left">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {isDragActive
                    ? "Drop the ZIP file here..."
                    : "Drag and drop a ZIP file here, or click to select"}
                </p>
              </>
            )}
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>Requirements:</p>
            <ul className="list-disc list-inside ml-2">
              <li>ZIP file format only</li>
              <li>Must contain an index.html file</li>
              <li>All assets (CSS, JS, images) should be included</li>
              <li>Maximum file size: 10MB</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!file || uploadFiles.isPending}
          >
            {uploadFiles.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
