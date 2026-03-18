import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { analyticsFunnelsApi } from "@/lib/api";
import type { CreateAnalyticsFunnelData, UpdateAnalyticsFunnelData } from "@/lib/types";

export const analyticsFunnelKeys = {
  all: ["analyticsFunnels"] as const,
  lists: () => [...analyticsFunnelKeys.all, "list"] as const,
  list: (configId: string) => [...analyticsFunnelKeys.lists(), configId] as const,
  details: () => [...analyticsFunnelKeys.all, "detail"] as const,
  detail: (configId: string, funnelId: string) => [...analyticsFunnelKeys.details(), configId, funnelId] as const,
  results: (configId: string, funnelId: string) => [...analyticsFunnelKeys.detail(configId, funnelId), "results"] as const,
};

export function useAnalyticsFunnels(configId: string) {
  return useQuery({
    queryKey: analyticsFunnelKeys.list(configId),
    queryFn: async () => {
      const response = await analyticsFunnelsApi.list(configId);
      return response.funnels;
    },
    enabled: !!configId,
  });
}

export function useAnalyticsFunnelResults(configId: string, funnelId: string) {
  return useQuery({
    queryKey: analyticsFunnelKeys.results(configId, funnelId),
    queryFn: async () => {
      const response = await analyticsFunnelsApi.getResults(configId, funnelId);
      return response;
    },
    enabled: !!configId && !!funnelId,
  });
}

export function useCreateAnalyticsFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ configId, data }: { configId: string; data: CreateAnalyticsFunnelData }) =>
      analyticsFunnelsApi.create(configId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: analyticsFunnelKeys.list(variables.configId) });
    },
  });
}

export function useUpdateAnalyticsFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ configId, funnelId, data }: { configId: string; funnelId: string; data: UpdateAnalyticsFunnelData }) =>
      analyticsFunnelsApi.update(configId, funnelId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: analyticsFunnelKeys.list(variables.configId) });
      queryClient.invalidateQueries({ queryKey: analyticsFunnelKeys.results(variables.configId, variables.funnelId) });
    },
  });
}

export function useDeleteAnalyticsFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ configId, funnelId }: { configId: string; funnelId: string }) =>
      analyticsFunnelsApi.delete(configId, funnelId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: analyticsFunnelKeys.list(variables.configId) });
      queryClient.removeQueries({ queryKey: analyticsFunnelKeys.detail(variables.configId, variables.funnelId) });
    },
  });
}

export function useRecomputeAnalyticsFunnel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ configId, funnelId }: { configId: string; funnelId: string }) =>
      analyticsFunnelsApi.recompute(configId, funnelId),
    onSuccess: (_, variables) => {
      // Invalidate results after recompute is queued -- the UI can poll for fresh results.
      queryClient.invalidateQueries({ queryKey: analyticsFunnelKeys.results(variables.configId, variables.funnelId) });
    },
  });
}
