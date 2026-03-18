"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ErrorPage, CreateErrorPageData } from "@/lib/types";

const API_BASE = "/api/error-pages";

// API functions
const maintenancePagesApi = {
  list: async (): Promise<ErrorPage[]> => {
    const response = await fetch(API_BASE);
    if (!response.ok) throw new Error("Failed to fetch maintenance pages");
    const data = await response.json();
    return (data.errorPages || []).filter(
      (page: ErrorPage) => page.type === "maintenance"
    );
  },

  get: async (id: string): Promise<ErrorPage> => {
    const response = await fetch(`${API_BASE}/${id}`);
    if (!response.ok) throw new Error("Failed to fetch maintenance page");
    const data = await response.json();
    return data.errorPage;
  },

  create: async (
    data: Omit<CreateErrorPageData, "type">
  ): Promise<{ errorPage: ErrorPage }> => {
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, type: "maintenance" }),
    });
    if (!response.ok) throw new Error("Failed to create maintenance page");
    return response.json();
  },

  uploadFiles: async (id: string, formData: FormData): Promise<ErrorPage> => {
    const response = await fetch(`${API_BASE}/${id}/upload`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw new Error("Failed to upload files");
    const data = await response.json();
    return data.errorPage;
  },

  delete: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete maintenance page");
  },

  regeneratePreview: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/${id}/regenerate-preview`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Failed to regenerate preview");
  },
};

// Query keys
export const maintenancePageKeys = {
  all: ["maintenance-pages"] as const,
  lists: () => [...maintenancePageKeys.all, "list"] as const,
  list: () => [...maintenancePageKeys.lists()] as const,
  details: () => [...maintenancePageKeys.all, "detail"] as const,
  detail: (id: string) => [...maintenancePageKeys.details(), id] as const,
};

// Hooks
export function useMaintenancePages() {
  return useQuery({
    queryKey: maintenancePageKeys.list(),
    queryFn: maintenancePagesApi.list,
  });
}

export function useMaintenancePage(id: string) {
  return useQuery({
    queryKey: maintenancePageKeys.detail(id),
    queryFn: () => maintenancePagesApi.get(id),
    enabled: !!id,
  });
}

export function useCreateMaintenancePage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: maintenancePagesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: maintenancePageKeys.lists() });
    },
  });
}

export function useUploadMaintenancePageFiles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) =>
      maintenancePagesApi.uploadFiles(id, formData),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: maintenancePageKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: maintenancePageKeys.detail(id),
      });
    },
  });
}

export function useDeleteMaintenancePage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: maintenancePagesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: maintenancePageKeys.lists() });
    },
  });
}

export function useRegenerateMaintenancePagePreview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: maintenancePagesApi.regeneratePreview,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({
        queryKey: maintenancePageKeys.detail(id),
      });
      queryClient.invalidateQueries({ queryKey: maintenancePageKeys.lists() });
    },
  });
}
