import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { maintenanceApi } from "@/lib/api";
import type { EnableMaintenanceData, ScheduleMaintenanceData } from "@/lib/types";
import { domainKeys } from "./use-domains";

export const maintenanceKeys = {
  all: ["maintenance"] as const,
  status: (domainId: string) => [...maintenanceKeys.all, "status", domainId] as const,
  windows: () => [...maintenanceKeys.all, "windows"] as const,
  windowsList: (options?: { domainId?: string; active?: boolean }) =>
    [...maintenanceKeys.windows(), options] as const,
};

export function useMaintenanceStatus(domainId: string) {
  return useQuery({
    queryKey: maintenanceKeys.status(domainId),
    queryFn: () => maintenanceApi.getStatus(domainId),
    enabled: !!domainId,
  });
}

export function useMaintenanceWindows(options?: { domainId?: string; active?: boolean }) {
  return useQuery({
    queryKey: maintenanceKeys.windowsList(options),
    queryFn: async () => {
      const response = await maintenanceApi.listWindows(options);
      return response.windows;
    },
  });
}

export function useEnableMaintenance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domainId, data }: { domainId: string; data?: EnableMaintenanceData }) =>
      maintenanceApi.enable(domainId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.status(variables.domainId) });
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.windows() });
      queryClient.invalidateQueries({ queryKey: domainKeys.detail(variables.domainId) });
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
    },
  });
}

export function useDisableMaintenance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domainId: string) => maintenanceApi.disable(domainId),
    onSuccess: (_, domainId) => {
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.status(domainId) });
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.windows() });
      queryClient.invalidateQueries({ queryKey: domainKeys.detail(domainId) });
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
    },
  });
}

export function useUpdateBypassIps() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domainId, bypassIps }: { domainId: string; bypassIps: string[] }) =>
      maintenanceApi.updateBypassIps(domainId, bypassIps),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.status(variables.domainId) });
      queryClient.invalidateQueries({ queryKey: domainKeys.detail(variables.domainId) });
    },
  });
}

export function useScheduleMaintenance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ScheduleMaintenanceData) => maintenanceApi.scheduleWindow(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.windows() });
      queryClient.invalidateQueries({ queryKey: domainKeys.detail(variables.domainId) });
    },
  });
}

export function useCancelMaintenanceWindow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => maintenanceApi.cancelWindow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.windows() });
    },
  });
}
