import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { analyticsConfigApi } from "@/lib/api";
import type { EnableAnalyticsData, UpdateAnalyticsConfigData } from "@/lib/types";

export const analyticsConfigKeys = {
  all: ["analyticsConfig"] as const,
  lists: () => [...analyticsConfigKeys.all, "list"] as const,
  details: () => [...analyticsConfigKeys.all, "detail"] as const,
  detail: (domainId: string) => [...analyticsConfigKeys.details(), domainId] as const,
};

export function useAnalyticsConfigs() {
  return useQuery({
    queryKey: analyticsConfigKeys.lists(),
    queryFn: async () => {
      const response = await analyticsConfigApi.list();
      return response.configs;
    },
  });
}

export function useAnalyticsConfig(domainId: string) {
  return useQuery({
    queryKey: analyticsConfigKeys.detail(domainId),
    queryFn: async () => {
      const response = await analyticsConfigApi.get(domainId);
      return response.config;
    },
    enabled: !!domainId,
  });
}

export function useEnableAnalytics() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domainId, data }: { domainId: string; data?: EnableAnalyticsData }) =>
      analyticsConfigApi.enable(domainId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.detail(variables.domainId) });
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.lists() });
    },
  });
}

export function useDisableAnalytics() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domainId: string) => analyticsConfigApi.disable(domainId),
    onSuccess: (_, domainId) => {
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.detail(domainId) });
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.lists() });
    },
  });
}

export function useUpdateAnalyticsConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domainId, data }: { domainId: string; data: UpdateAnalyticsConfigData }) =>
      analyticsConfigApi.update(domainId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.detail(variables.domainId) });
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.lists() });
    },
  });
}

export function useDeleteAnalyticsConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domainId: string) => analyticsConfigApi.delete(domainId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.lists() });
    },
  });
}

export function useRegenerateTrackingUuid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domainId: string) => analyticsConfigApi.regenerateUuid(domainId),
    onSuccess: (_, domainId) => {
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.detail(domainId) });
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.lists() });
    },
  });
}

export function useRegenerateApiToken() {
  return useMutation({
    mutationFn: (domainId: string) => analyticsConfigApi.regenerateApiToken(domainId),
  });
}

export function useRotatePublicDashboardToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domainId: string) => analyticsConfigApi.rotatePublicDashboardToken(domainId),
    onSuccess: (_, domainId) => {
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.detail(domainId) });
      queryClient.invalidateQueries({ queryKey: analyticsConfigKeys.lists() });
    },
  });
}
