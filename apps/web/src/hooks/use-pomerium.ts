import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  pomeriumIdpsApi,
  pomeriumRoutesApi,
  pomeriumSettingsApi,
} from "@/lib/api";
import type {
  CreatePomeriumIdpData,
  UpdatePomeriumIdpData,
  CreatePomeriumRouteData,
  UpdatePomeriumRouteData,
  UpdatePomeriumSettingsData,
} from "@/lib/types";

export const pomeriumKeys = {
  all: ["pomerium"] as const,
  // Identity Providers
  idps: () => [...pomeriumKeys.all, "idps"] as const,
  idp: (id: string) => [...pomeriumKeys.idps(), id] as const,
  // Routes
  routes: () => [...pomeriumKeys.all, "routes"] as const,
  route: (id: string) => [...pomeriumKeys.routes(), id] as const,
  routesByDomain: (domainId: string) =>
    [...pomeriumKeys.routes(), "domain", domainId] as const,
  // Settings
  settings: () => [...pomeriumKeys.all, "settings"] as const,
  status: () => [...pomeriumKeys.all, "status"] as const,
};

export function usePomeriumIdps() {
  return useQuery({
    queryKey: pomeriumKeys.idps(),
    queryFn: async () => {
      const response = await pomeriumIdpsApi.list();
      return response.identityProviders;
    },
  });
}

export function usePomeriumIdp(id: string) {
  return useQuery({
    queryKey: pomeriumKeys.idp(id),
    queryFn: async () => {
      const response = await pomeriumIdpsApi.get(id);
      return response.identityProvider;
    },
    enabled: !!id,
  });
}

export function useCreatePomeriumIdp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePomeriumIdpData) => pomeriumIdpsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.idps() });
    },
  });
}

export function useUpdatePomeriumIdp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePomeriumIdpData }) =>
      pomeriumIdpsApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: pomeriumKeys.idp(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.idps() });
    },
  });
}

export function useDeletePomeriumIdp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => pomeriumIdpsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.idps() });
    },
  });
}

export function useTestPomeriumIdp() {
  return useMutation({
    mutationFn: (id: string) => pomeriumIdpsApi.test(id),
  });
}

export function usePomeriumRoutes(domainId?: string) {
  return useQuery({
    queryKey: domainId
      ? pomeriumKeys.routesByDomain(domainId)
      : pomeriumKeys.routes(),
    queryFn: async () => {
      const response = await pomeriumRoutesApi.list(domainId);
      return response.routes;
    },
  });
}

export function usePomeriumRoute(id: string) {
  return useQuery({
    queryKey: pomeriumKeys.route(id),
    queryFn: async () => {
      const response = await pomeriumRoutesApi.get(id);
      return response.route;
    },
    enabled: !!id,
  });
}

export function useCreatePomeriumRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePomeriumRouteData) =>
      pomeriumRoutesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.routes() });
    },
  });
}

export function useUpdatePomeriumRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePomeriumRouteData }) =>
      pomeriumRoutesApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: pomeriumKeys.route(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.routes() });
    },
  });
}

export function useDeletePomeriumRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => pomeriumRoutesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.routes() });
    },
  });
}

export function useTogglePomeriumRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => pomeriumRoutesApi.toggle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.routes() });
    },
  });
}

export function usePomeriumRoutesByDomain(domainId: string) {
  return useQuery({
    queryKey: pomeriumKeys.routesByDomain(domainId),
    queryFn: async () => {
      const response = await pomeriumRoutesApi.listByDomain(domainId);
      return response.routes;
    },
    enabled: !!domainId,
  });
}

export function usePomeriumSettings() {
  return useQuery({
    queryKey: pomeriumKeys.settings(),
    queryFn: async () => {
      const response = await pomeriumSettingsApi.get();
      return response.settings;
    },
  });
}

export function useUpdatePomeriumSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdatePomeriumSettingsData) =>
      pomeriumSettingsApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.settings() });
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.status() });
    },
  });
}

export function useRegeneratePomeriumSecrets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => pomeriumSettingsApi.regenerateSecrets(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.settings() });
    },
  });
}

export function usePomeriumStatus() {
  return useQuery({
    queryKey: pomeriumKeys.status(),
    queryFn: async () => {
      return await pomeriumSettingsApi.getStatus();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useRestartPomerium() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      pomeriumSettingsApi.restart(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pomeriumKeys.status() });
    },
  });
}
