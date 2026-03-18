"use client";

import { useState, useRef } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  useToast,
} from "@uni-proxy-manager/ui";
import { Download, Upload, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useExportSettings, useImportSettings } from "@/hooks/use-settings-export-import";
import type { ImportResult } from "@/hooks/use-settings-export-import";

export function ExportImportSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Export state
  const [includeCertificates, setIncludeCertificates] = useState(true);
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const exportMutation = useExportSettings();

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [importCertFiles, setImportCertFiles] = useState(true);
  const [importSensitiveData, setImportSensitiveData] = useState(true);
  const importMutation = useImportSettings();

  // Result dialog
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);

  const handleExport = async () => {
    try {
      const { blob, filename } = await exportMutation.mutateAsync({
        includeCertificates,
        includeSensitive,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded", description: filename });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    try {
      const result = await importMutation.mutateAsync({
        file: selectedFile,
        options: {
          overwriteExisting,
          importCertFiles,
          importSensitiveData,
        },
      });
      setImportResult(result);
      setResultOpen(true);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      // Invalidate all cached queries so the UI reflects imported data
      await queryClient.invalidateQueries();
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Settings
          </CardTitle>
          <CardDescription>
            Download a ZIP archive of all your proxy configuration, domains, backends, certificates,
            and DNS providers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Checkbox
                id="includeCertificates"
                checked={includeCertificates}
                onCheckedChange={(v) => setIncludeCertificates(Boolean(v))}
              />
              <Label htmlFor="includeCertificates" className="cursor-pointer">
                Include certificate files (.pem)
              </Label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="includeSensitive"
                checked={includeSensitive}
                onCheckedChange={(v) => setIncludeSensitive(Boolean(v))}
              />
              <div className="space-y-1">
                <Label htmlFor="includeSensitive" className="cursor-pointer">
                  Include sensitive data
                </Label>
                <p className="text-xs text-muted-foreground">
                  DNS provider API keys and credentials. Store the exported file securely.
                </p>
                {includeSensitive && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>The export will contain plaintext credentials. Handle with care.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <Button
            onClick={handleExport}
            disabled={exportMutation.isPending}
            className="w-full sm:w-auto"
          >
            <Download className="mr-2 h-4 w-4" />
            {exportMutation.isPending ? "Exporting..." : "Export"}
          </Button>
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Settings
          </CardTitle>
          <CardDescription>
            Restore configuration from a previously exported ZIP archive. Existing records are
            preserved by default unless you choose to overwrite them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="importFile" className="mb-2 block text-sm font-medium">
              ZIP archive
            </Label>
            <input
              id="importFile"
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileChange}
              className="block w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium"
            />
            {selectedFile && (
              <p className="mt-1 text-xs text-muted-foreground">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="overwriteExisting"
                checked={overwriteExisting}
                onCheckedChange={(v) => setOverwriteExisting(Boolean(v))}
              />
              <div className="space-y-1">
                <Label htmlFor="overwriteExisting" className="cursor-pointer">
                  Overwrite existing records
                </Label>
                <p className="text-xs text-muted-foreground">
                  Records with matching IDs will be updated. When unchecked, conflicting records are
                  skipped.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="importCertFiles"
                checked={importCertFiles}
                onCheckedChange={(v) => setImportCertFiles(Boolean(v))}
              />
              <Label htmlFor="importCertFiles" className="cursor-pointer">
                Restore certificate files
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="importSensitiveData"
                checked={importSensitiveData}
                onCheckedChange={(v) => setImportSensitiveData(Boolean(v))}
              />
              <Label htmlFor="importSensitiveData" className="cursor-pointer">
                Restore sensitive credentials (DNS API keys)
              </Label>
            </div>
          </div>

          <Button
            onClick={handleImport}
            disabled={!selectedFile || importMutation.isPending}
            className="w-full sm:w-auto"
          >
            <Upload className="mr-2 h-4 w-4" />
            {importMutation.isPending ? "Importing..." : "Import"}
          </Button>
        </CardContent>
      </Card>

      {/* Import result dialog */}
      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Import Complete</DialogTitle>
            <DialogDescription>
              Settings have been imported and HAProxy reload has been queued.
            </DialogDescription>
          </DialogHeader>

          {importResult && (
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-semibold">Imported</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {Object.entries(importResult.imported).map(([key, count]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-muted-foreground capitalize">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {Object.values(importResult.skipped).some((v) => v > 0) && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Skipped (already exist)</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    {Object.entries(importResult.skipped)
                      .filter(([, count]) => count > 0)
                      .map(([key, count]) => (
                        <div key={key} className="flex justify-between">
                          <span className="text-muted-foreground capitalize">
                            {key.replace(/([A-Z])/g, " $1").trim()}
                          </span>
                          <span className="font-medium">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {importResult.warnings.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    Warnings
                  </h4>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {importResult.warnings.map((w, i) => (
                      <li key={i} className="rounded bg-muted px-2 py-1">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
