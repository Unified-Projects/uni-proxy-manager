import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { domainsApi } from "@/lib/api";
import type { CreateDomainData, UpdateDomainData } from "@/lib/types";

export const domainKeys = {
  all: ["domains"] as const,
  lists: () => [...domainKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) => [...domainKeys.lists(), filters] as const,
  details: () => [...domainKeys.all, "detail"] as const,
  detail: (id: string) => [...domainKeys.details(), id] as const,
};

export function useDomains() {
  return useQuery({
    queryKey: domainKeys.lists(),
    queryFn: async () => {
      const response = await domainsApi.list();
      return response.domains;
    },
  });
}

export function useDomain(id: string) {
  return useQuery({
    queryKey: domainKeys.detail(id),
    queryFn: async () => {
      const response = await domainsApi.get(id);
      return response.domain;
    },
    enabled: !!id,
  });
}

export function useCreateDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDomainData) => domainsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
    },
  });
}

export function useUpdateDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDomainData }) =>
      domainsApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: domainKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
    },
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => domainsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
    },
  });
}
