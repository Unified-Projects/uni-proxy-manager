import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  domainRouteRulesApi,
  domainIpRulesApi,
  domainSecurityHeadersApi,
  domainBlockedRoutesApi,
} from "@/lib/api";
import type {
  CreateDomainRouteRuleData,
  UpdateDomainRouteRuleData,
  UpdateDomainIpRuleData,
  UpdateDomainSecurityHeadersData,
  CreateDomainBlockedRouteData,
  UpdateDomainBlockedRouteData,
} from "@/lib/types";

// =============================================================================
// Query Keys
// =============================================================================

export const domainAdvancedConfigKeys = {
  all: ["domain-advanced-config"] as const,
  // Route Rules
  routeRules: () => [...domainAdvancedConfigKeys.all, "route-rules"] as const,
  routeRule: (id: string) => [...domainAdvancedConfigKeys.routeRules(), id] as const,
  routeRulesByDomain: (domainId: string) =>
    [...domainAdvancedConfigKeys.routeRules(), "domain", domainId] as const,
  // IP Rules
  ipRules: () => [...domainAdvancedConfigKeys.all, "ip-rules"] as const,
  ipRule: (domainId: string) => [...domainAdvancedConfigKeys.ipRules(), domainId] as const,
  // Security Headers
  securityHeaders: () => [...domainAdvancedConfigKeys.all, "security-headers"] as const,
  securityHeader: (domainId: string) =>
    [...domainAdvancedConfigKeys.securityHeaders(), domainId] as const,
  securityHeaderPreview: (domainId: string) =>
    [...domainAdvancedConfigKeys.securityHeaders(), domainId, "preview"] as const,
  // Blocked Routes
  blockedRoutes: () => [...domainAdvancedConfigKeys.all, "blocked-routes"] as const,
  blockedRoute: (id: string) => [...domainAdvancedConfigKeys.blockedRoutes(), id] as const,
  blockedRoutesByDomain: (domainId: string) =>
    [...domainAdvancedConfigKeys.blockedRoutes(), "domain", domainId] as const,
};

// =============================================================================
// Domain Route Rules Hooks
// =============================================================================

export function useDomainRouteRules(domainId?: string) {
  return useQuery({
    queryKey: domainId
      ? domainAdvancedConfigKeys.routeRulesByDomain(domainId)
      : domainAdvancedConfigKeys.routeRules(),
    queryFn: async () => {
      const response = await domainRouteRulesApi.list(domainId);
      return response.routeRules;
    },
  });
}

export function useDomainRouteRule(id: string) {
  return useQuery({
    queryKey: domainAdvancedConfigKeys.routeRule(id),
    queryFn: async () => {
      const response = await domainRouteRulesApi.get(id);
      return response.routeRule;
    },
    enabled: !!id,
  });
}

export function useCreateDomainRouteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDomainRouteRuleData) => domainRouteRulesApi.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: domainAdvancedConfigKeys.routeRules() });
      if (variables.domainId) {
        queryClient.invalidateQueries({
          queryKey: domainAdvancedConfigKeys.routeRulesByDomain(variables.domainId),
        });
      }
    },
  });
}

export function useUpdateDomainRouteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDomainRouteRuleData }) =>
      domainRouteRulesApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: domainAdvancedConfigKeys.routeRule(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: domainAdvancedConfigKeys.routeRules() });
    },
  });
}

export function useDeleteDomainRouteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => domainRouteRulesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainAdvancedConfigKeys.routeRules() });
    },
  });
}

export function useToggleDomainRouteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => domainRouteRulesApi.toggle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainAdvancedConfigKeys.routeRules() });
    },
  });
}

export function useReorderDomainRouteRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rules: Array<{ id: string; priority: number }>) =>
      domainRouteRulesApi.reorder(rules),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainAdvancedConfigKeys.routeRules() });
    },
  });
}

// =============================================================================
// Domain IP Rules Hooks
// =============================================================================

export function useDomainIpRule(domainId: string) {
  return useQuery({
    queryKey: domainAdvancedConfigKeys.ipRule(domainId),
    queryFn: async () => {
      const response = await domainIpRulesApi.get(domainId);
      return response.ipRule;
    },
    enabled: !!domainId,
  });
}

export function useUpdateDomainIpRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ domainId, data }: { domainId: string; data: UpdateDomainIpRuleData }) =>
      domainIpRulesApi.update(domainId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: domainAdvancedConfigKeys.ipRule(variables.domainId),
      });
    },
  });
}

export function useToggleDomainIpRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domainId: string) => domainIpRulesApi.toggle(domainId),
    onSuccess: (_, domainId) => {
      queryClient.invalidateQueries({
        queryKey: domainAdvancedConfigKeys.ipRule(domainId),
      });
    },
  });
}

export function useValidateDomainIps() {
  return useMutation({
    mutationFn: ({ domainId, ipAddresses }: { domainId: string; ipAddresses: string[] }) =>
      domainIpRulesApi.validate(domainId, ipAddresses),
  });
}

// =============================================================================
// Domain Security Headers Hooks
// =============================================================================

export function useDomainSecurityHeaders(domainId: string) {
  return useQuery({
    queryKey: domainAdvancedConfigKeys.securityHeader(domainId),
    queryFn: async () => {
      const response = await domainSecurityHeadersApi.get(domainId);
      return response.securityHeaders;
    },
    enabled: !!domainId,
  });
}

export function useUpdateDomainSecurityHeaders() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      domainId,
      data,
    }: {
      domainId: string;
      data: UpdateDomainSecurityHeadersData;
    }) => domainSecurityHeadersApi.update(domainId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: domainAdvancedConfigKeys.securityHeader(variables.domainId),
      });
      queryClient.invalidateQueries({
        queryKey: domainAdvancedConfigKeys.securityHeaderPreview(variables.domainId),
      });
    },
  });
}

export function useDomainSecurityHeadersPreview(domainId: string) {
  return useQuery({
    queryKey: domainAdvancedConfigKeys.securityHeaderPreview(domainId),
    queryFn: async () => {
      const response = await domainSecurityHeadersApi.preview(domainId);
      return response.headers;
    },
    enabled: !!domainId,
  });
}

// =============================================================================
// Domain Blocked Routes Hooks
// =============================================================================

export function useDomainBlockedRoutes(domainId?: string) {
  return useQuery({
    queryKey: domainId
      ? domainAdvancedConfigKeys.blockedRoutesByDomain(domainId)
      : domainAdvancedConfigKeys.blockedRoutes(),
    queryFn: async () => {
      const response = await domainBlockedRoutesApi.list(domainId);
      return response.blockedRoutes;
    },
  });
}

export function useDomainBlockedRoute(id: string) {
  return useQuery({
    queryKey: domainAdvancedConfigKeys.blockedRoute(id),
    queryFn: async () => {
      const response = await domainBlockedRoutesApi.get(id);
      return response.blockedRoute;
    },
    enabled: !!id,
  });
}

export function useCreateDomainBlockedRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDomainBlockedRouteData) => domainBlockedRoutesApi.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: domainAdvancedConfigKeys.blockedRoutes() });
      if (variables.domainId) {
        queryClient.invalidateQueries({
          queryKey: domainAdvancedConfigKeys.blockedRoutesByDomain(variables.domainId),
        });
      }
    },
  });
}

export function useUpdateDomainBlockedRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDomainBlockedRouteData }) =>
      domainBlockedRoutesApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: domainAdvancedConfigKeys.blockedRoute(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: domainAdvancedConfigKeys.blockedRoutes() });
    },
  });
}

export function useDeleteDomainBlockedRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => domainBlockedRoutesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainAdvancedConfigKeys.blockedRoutes() });
    },
  });
}

export function useToggleDomainBlockedRoute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => domainBlockedRoutesApi.toggle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: domainAdvancedConfigKeys.blockedRoutes() });
    },
  });
}
