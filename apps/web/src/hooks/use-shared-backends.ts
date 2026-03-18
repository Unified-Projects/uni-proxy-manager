import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sharedBackendsApi } from "@/lib/api";
import type { CreateSharedBackendData, UpdateSharedBackendData } from "@/lib/types";

export const sharedBackendKeys = {
  all: ["shared-backends"] as const,
  lists: () => [...sharedBackendKeys.all, "list"] as const,
  details: () => [...sharedBackendKeys.all, "detail"] as const,
  detail: (id: string) => [...sharedBackendKeys.details(), id] as const,
};

export function useSharedBackends() {
  return useQuery({
    queryKey: sharedBackendKeys.lists(),
    queryFn: async () => {
      const response = await sharedBackendsApi.list();
      return response.sharedBackends;
    },
  });
}

export function useSharedBackend(id: string) {
  return useQuery({
    queryKey: sharedBackendKeys.detail(id),
    queryFn: async () => {
      const response = await sharedBackendsApi.get(id);
      return response.sharedBackend;
    },
    enabled: !!id,
  });
}

export function useCreateSharedBackend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSharedBackendData) => sharedBackendsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sharedBackendKeys.lists() });
    },
  });
}

export function useUpdateSharedBackend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSharedBackendData }) =>
      sharedBackendsApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: sharedBackendKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: sharedBackendKeys.lists() });
    },
  });
}

export function useDeleteSharedBackend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      sharedBackendsApi.delete(id, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sharedBackendKeys.lists() });
    },
  });
}

export function useToggleSharedBackend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => sharedBackendsApi.toggle(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: sharedBackendKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: sharedBackendKeys.lists() });
    },
  });
}

export function useLinkDomainToSharedBackend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, domainId }: { id: string; domainId: string }) =>
      sharedBackendsApi.linkDomain(id, domainId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: sharedBackendKeys.detail(variables.id) });
    },
  });
}

export function useUnlinkDomainFromSharedBackend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, domainId }: { id: string; domainId: string }) =>
      sharedBackendsApi.unlinkDomain(id, domainId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: sharedBackendKeys.detail(variables.id) });
    },
  });
}
