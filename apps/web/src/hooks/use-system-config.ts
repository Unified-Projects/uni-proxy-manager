import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { systemConfigApi, type RetentionConfig, type BuildDefaultsConfig, type HaproxyWatchdogConfig } from "@/lib/api";

export const systemConfigKeys = {
  all: ["systemConfig"] as const,
  retention: () => [...systemConfigKeys.all, "retention"] as const,
  buildDefaults: () => [...systemConfigKeys.all, "buildDefaults"] as const,
  haproxyWatchdog: () => [...systemConfigKeys.all, "haproxyWatchdog"] as const,
};

export function useRetentionConfig() {
  return useQuery({
    queryKey: systemConfigKeys.retention(),
    queryFn: async () => {
      const response = await systemConfigApi.getRetention();
      return response.retention;
    },
  });
}

export function useUpdateRetentionConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: RetentionConfig) => systemConfigApi.updateRetention(data),
    onSuccess: (response) => {
      queryClient.setQueryData(systemConfigKeys.retention(), response.retention);
    },
  });
}

export function useResetRetentionConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => systemConfigApi.resetRetention(),
    onSuccess: (response) => {
      queryClient.setQueryData(systemConfigKeys.retention(), response.retention);
    },
  });
}

export function useBuildDefaultsConfig() {
  return useQuery({
    queryKey: systemConfigKeys.buildDefaults(),
    queryFn: async () => {
      const response = await systemConfigApi.getBuildDefaults();
      return response.buildDefaults;
    },
  });
}

export function useUpdateBuildDefaultsConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BuildDefaultsConfig) => systemConfigApi.updateBuildDefaults(data),
    onSuccess: (response) => {
      queryClient.setQueryData(systemConfigKeys.buildDefaults(), response.buildDefaults);
    },
  });
}

export function useResetBuildDefaultsConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => systemConfigApi.resetBuildDefaults(),
    onSuccess: (response) => {
      queryClient.setQueryData(systemConfigKeys.buildDefaults(), response.buildDefaults);
    },
  });
}

export function useHaproxyWatchdogConfig() {
  return useQuery({
    queryKey: systemConfigKeys.haproxyWatchdog(),
    queryFn: async () => {
      const response = await systemConfigApi.getHaproxyWatchdog();
      return response.watchdog;
    },
  });
}

export function useUpdateHaproxyWatchdogConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: HaproxyWatchdogConfig) => systemConfigApi.updateHaproxyWatchdog(data),
    onSuccess: (response) => {
      queryClient.setQueryData(systemConfigKeys.haproxyWatchdog(), response.watchdog);
    },
  });
}
