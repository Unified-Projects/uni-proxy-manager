import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { backendsApi } from "@/lib/api";
import type { CreateBackendData, UpdateBackendData } from "@/lib/types";
import { domainKeys } from "./use-domains";

export const backendKeys = {
  all: ["backends"] as const,
  lists: () => [...backendKeys.all, "list"] as const,
  list: (domainId?: string) => [...backendKeys.lists(), { domainId }] as const,
  details: () => [...backendKeys.all, "detail"] as const,
  detail: (id: string) => [...backendKeys.details(), id] as const,
};

export function useBackends(domainId?: string) {
  return useQuery({
    queryKey: backendKeys.list(domainId),
    queryFn: async () => {
      const response = await backendsApi.list(domainId);
      return response.backends;
    },
  });
}

export function useBackend(id: string) {
  return useQuery({
    queryKey: backendKeys.detail(id),
    queryFn: async () => {
      const response = await backendsApi.get(id);
      return response.backend;
    },
    enabled: !!id,
  });
}

export function useCreateBackend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBackendData) => backendsApi.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: backendKeys.lists() });
      // Also invalidate the parent domain
      queryClient.invalidateQueries({ queryKey: domainKeys.detail(variables.domainId) });
    },
  });
}

export function useUpdateBackend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBackendData }) =>
      backendsApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: backendKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: backendKeys.lists() });
    },
  });
}

export function useDeleteBackend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => backendsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backendKeys.lists() });
    },
  });
}
