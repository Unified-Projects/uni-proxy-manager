import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { haproxyApi } from "@/lib/api";

export const haproxyKeys = {
  all: ["haproxy"] as const,
  status: () => [...haproxyKeys.all, "status"] as const,
  config: () => [...haproxyKeys.all, "config"] as const,
  preview: () => [...haproxyKeys.all, "preview"] as const,
  diff: () => [...haproxyKeys.all, "diff"] as const,
};

export function useHaproxyStatus() {
  return useQuery({
    queryKey: haproxyKeys.status(),
    queryFn: () => haproxyApi.status(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useHaproxyConfig() {
  return useQuery({
    queryKey: haproxyKeys.config(),
    queryFn: () => haproxyApi.getConfig(),
  });
}

export function useHaproxyConfigPreview() {
  return useQuery({
    queryKey: haproxyKeys.preview(),
    queryFn: () => haproxyApi.previewConfig(),
  });
}

export function useHaproxyConfigDiff() {
  return useQuery({
    queryKey: haproxyKeys.diff(),
    queryFn: () => haproxyApi.getConfigDiff(),
    refetchInterval: 30000, // Check for changes every 30 seconds
  });
}

export function useHaproxyReload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (force?: boolean) => haproxyApi.reload(force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: haproxyKeys.status() });
      queryClient.invalidateQueries({ queryKey: haproxyKeys.config() });
      queryClient.invalidateQueries({ queryKey: haproxyKeys.diff() });
      queryClient.invalidateQueries({ queryKey: haproxyKeys.preview() });
    },
  });
}
