import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dnsProvidersApi } from "@/lib/api";
import type { CreateDnsProviderData, UpdateDnsProviderData } from "@/lib/types";

export const dnsProviderKeys = {
  all: ["dns-providers"] as const,
  lists: () => [...dnsProviderKeys.all, "list"] as const,
  list: () => [...dnsProviderKeys.lists()] as const,
  details: () => [...dnsProviderKeys.all, "detail"] as const,
  detail: (id: string) => [...dnsProviderKeys.details(), id] as const,
};

export function useDnsProviders() {
  return useQuery({
    queryKey: dnsProviderKeys.list(),
    queryFn: async () => {
      const response = await dnsProvidersApi.list();
      return response.providers;
    },
  });
}

export function useDnsProvider(id: string) {
  return useQuery({
    queryKey: dnsProviderKeys.detail(id),
    queryFn: async () => {
      const response = await dnsProvidersApi.get(id);
      return response.provider;
    },
    enabled: !!id,
  });
}

export function useCreateDnsProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDnsProviderData) => dnsProvidersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dnsProviderKeys.lists() });
    },
  });
}

export function useUpdateDnsProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDnsProviderData }) =>
      dnsProvidersApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: dnsProviderKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: dnsProviderKeys.lists() });
    },
  });
}

export function useTestDnsProvider() {
  return useMutation({
    mutationFn: (id: string) => dnsProvidersApi.test(id),
  });
}

export function useSetDefaultDnsProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => dnsProvidersApi.setDefault(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dnsProviderKeys.lists() });
    },
  });
}

export function useDeleteDnsProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => dnsProvidersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dnsProviderKeys.lists() });
    },
  });
}
