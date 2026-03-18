import { useMutation } from "@tanstack/react-query";

export interface ExportOptions {
  includeCertificates?: boolean;
  includeSensitive?: boolean;
}

export interface ImportOptions {
  overwriteExisting?: boolean;
  importCertFiles?: boolean;
  importSensitiveData?: boolean;
}

export interface ImportResult {
  imported: Record<string, number>;
  skipped: Record<string, number>;
  warnings: string[];
}

export function useExportSettings() {
  return useMutation({
    mutationFn: async (options: ExportOptions = {}) => {
      const params = new URLSearchParams();
      if (options.includeCertificates === false) {
        params.set("includeCertificates", "false");
      }
      if (options.includeSensitive === true) {
        params.set("includeSensitive", "true");
      }

      const qs = params.toString();
      const url = `/api/settings/export${qs ? `?${qs}` : ""}`;

      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Export failed" }));
        throw new Error((data as { error?: string }).error ?? "Export failed");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `upm-export-${new Date().toISOString().slice(0, 10)}.zip`;

      return { blob, filename };
    },
  });
}

export function useImportSettings() {
  return useMutation({
    mutationFn: async ({
      file,
      options = {},
    }: {
      file: File;
      options?: ImportOptions;
    }): Promise<ImportResult> => {
      const params = new URLSearchParams();
      if (options.overwriteExisting === true) params.set("overwriteExisting", "true");
      if (options.importCertFiles === false) params.set("importCertFiles", "false");
      if (options.importSensitiveData === false) params.set("importSensitiveData", "false");

      const qs = params.toString();
      const url = `/api/settings/import${qs ? `?${qs}` : ""}`;

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Import failed" }));
        throw new Error((data as { error?: string }).error ?? "Import failed");
      }

      return response.json() as Promise<ImportResult>;
    },
  });
}
