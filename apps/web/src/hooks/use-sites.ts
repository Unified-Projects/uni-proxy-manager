import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sitesApi, deploymentsApi, githubApi, siteAnalyticsApi, s3ProvidersApi, siteDomainsApi } from "@/lib/api";
import type {
  CreateSiteData,
  UpdateSiteData,
  ConnectGitHubData,
  UpdateGitHubConnectionData,
  CreateS3ProviderData,
  UpdateS3ProviderData,
  Domain,
} from "@/lib/types";

export const siteKeys = {
  all: ["sites"] as const,
  lists: () => [...siteKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) => [...siteKeys.lists(), filters] as const,
  details: () => [...siteKeys.all, "detail"] as const,
  detail: (id: string) => [...siteKeys.details(), id] as const,
  env: (id: string) => [...siteKeys.detail(id), "env"] as const,
};

export function useSites() {
  return useQuery({
    queryKey: siteKeys.lists(),
    queryFn: async () => {
      const response = await sitesApi.list();
      return response.sites;
    },
  });
}

export function useSite(id: string) {
  return useQuery({
    queryKey: siteKeys.detail(id),
    queryFn: async () => {
      const response = await sitesApi.get(id);
      return response.site;
    },
    enabled: !!id,
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSiteData) => sitesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
    },
  });
}

export function useUpdateSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSiteData }) =>
      sitesApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: siteKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
    },
  });
}

export function useDeleteSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => sitesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
    },
  });
}

export function useDeploySite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => sitesApi.deploy(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: siteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
    },
  });
}

export function useUploadDeploySite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => sitesApi.uploadDeploy(id, file),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: siteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
    },
  });
}

export function useRollbackSite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, deploymentId }: { siteId: string; deploymentId: string }) =>
      sitesApi.rollback(siteId, deploymentId),
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: siteKeys.detail(siteId) });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
    },
  });
}

export function useSiteEnv(id: string) {
  return useQuery({
    queryKey: siteKeys.env(id),
    queryFn: async () => {
      const response = await sitesApi.getEnv(id);
      return response;
    },
    enabled: !!id,
  });
}

export function useUpdateSiteEnv() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, envVariables }: { id: string; envVariables: Record<string, string> }) =>
      sitesApi.updateEnv(id, envVariables),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: siteKeys.env(variables.id) });
    },
  });
}

export const deploymentKeys = {
  all: ["deployments"] as const,
  lists: () => [...deploymentKeys.all, "list"] as const,
  list: (siteId?: string) => [...deploymentKeys.lists(), siteId] as const,
  details: () => [...deploymentKeys.all, "detail"] as const,
  detail: (id: string) => [...deploymentKeys.details(), id] as const,
  logs: (id: string) => [...deploymentKeys.detail(id), "logs"] as const,
  preview: (id: string) => [...deploymentKeys.detail(id), "preview"] as const,
};

export function useDeployments(siteId?: string) {
  return useQuery({
    queryKey: deploymentKeys.list(siteId),
    queryFn: async () => {
      const response = await deploymentsApi.list(siteId);
      return response.deployments;
    },
  });
}

export function useDeployment(id: string) {
  return useQuery({
    queryKey: deploymentKeys.detail(id),
    queryFn: async () => {
      const response = await deploymentsApi.get(id);
      return response.deployment;
    },
    enabled: !!id,
  });
}

export function useDeploymentLogs(id: string) {
  return useQuery({
    queryKey: deploymentKeys.logs(id),
    queryFn: async () => {
      const response = await deploymentsApi.getLogs(id);
      return response;
    },
    enabled: !!id,
    refetchInterval: (data) => {
      // Stop polling once complete
      if (data?.state?.data?.complete) return false;
      return 2000; // Poll every 2 seconds while building
    },
  });
}

export function useCancelDeployment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deploymentsApi.cancel(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: deploymentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
    },
  });
}

export function usePromoteDeployment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deploymentsApi.promote(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: deploymentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
    },
  });
}

export function useRetryDeployment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deploymentsApi.retry(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: deploymentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
    },
  });
}

export function useRedeployDeployment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deploymentsApi.redeploy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
    },
  });
}

export function useDeleteDeployment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deploymentsApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: deploymentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: siteKeys.lists() });
      queryClient.removeQueries({ queryKey: deploymentKeys.detail(id) });
    },
  });
}

export function useDeploymentPreview(id: string) {
  return useQuery({
    queryKey: deploymentKeys.preview(id),
    queryFn: async () => {
      const response = await deploymentsApi.getPreview(id);
      return response;
    },
    enabled: !!id,
  });
}

export function useGeneratePreview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deploymentsApi.generatePreview(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: deploymentKeys.preview(id) });
    },
  });
}

export const githubKeys = {
  all: ["github"] as const,
  status: () => [...githubKeys.all, "status"] as const,
  installUrl: (siteId?: string) => [...githubKeys.all, "installUrl", siteId] as const,
  repositories: (installationId: number) => [...githubKeys.all, "repositories", installationId] as const,
  connection: (siteId: string) => [...githubKeys.all, "connection", siteId] as const,
  branches: (siteId: string) => [...githubKeys.all, "branches", siteId] as const,
};

export function useGitHubStatus() {
  return useQuery({
    queryKey: githubKeys.status(),
    queryFn: async () => {
      const response = await githubApi.status();
      return response;
    },
  });
}

export function useGitHubInstallUrl(siteId?: string) {
  return useQuery({
    queryKey: githubKeys.installUrl(siteId),
    queryFn: async () => {
      const response = await githubApi.getInstallUrl(siteId);
      return response.installUrl;
    },
    enabled: false, // Only fetch when needed
  });
}

export function useGitHubRepositories(installationId?: number) {
  return useQuery({
    queryKey: githubKeys.repositories(installationId ?? 0),
    queryFn: async () => {
      if (!installationId) return [];
      const response = await githubApi.listRepositories(installationId);
      return response.repositories;
    },
    enabled: !!installationId,
  });
}

export function useGitHubConnection(siteId: string) {
  return useQuery({
    queryKey: githubKeys.connection(siteId),
    queryFn: async () => {
      const response = await githubApi.getSiteConnection(siteId);
      return response;
    },
    enabled: !!siteId,
  });
}

export function useConnectGitHub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, data }: { siteId: string; data: ConnectGitHubData }) =>
      githubApi.connect(siteId, data),
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: githubKeys.connection(siteId) });
      queryClient.invalidateQueries({ queryKey: siteKeys.detail(siteId) });
    },
  });
}

export function useUpdateGitHubConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, data }: { siteId: string; data: UpdateGitHubConnectionData }) =>
      githubApi.updateConnection(siteId, data),
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: githubKeys.connection(siteId) });
    },
  });
}

export function useDisconnectGitHub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (siteId: string) => githubApi.disconnect(siteId),
    onSuccess: (_, siteId) => {
      queryClient.invalidateQueries({ queryKey: githubKeys.connection(siteId) });
      queryClient.invalidateQueries({ queryKey: siteKeys.detail(siteId) });
    },
  });
}

export function useGitHubBranches(siteId: string, enabled = true) {
  return useQuery({
    queryKey: githubKeys.branches(siteId),
    queryFn: async () => {
      const response = await githubApi.listBranches(siteId);
      return response.branches;
    },
    enabled: !!siteId && enabled,
  });
}

export function useSyncGitHub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (siteId: string) => githubApi.sync(siteId),
    onSuccess: (_, siteId) => {
      queryClient.invalidateQueries({ queryKey: githubKeys.connection(siteId) });
    },
  });
}

export const analyticsKeys = {
  all: ["siteAnalytics"] as const,
  summary: (siteId: string, range?: { start?: string; end?: string }) =>
    [...analyticsKeys.all, "summary", siteId, range] as const,
  visitors: (siteId: string, range?: { start?: string; end?: string; interval?: string }) =>
    [...analyticsKeys.all, "visitors", siteId, range] as const,
  geography: (siteId: string, range?: { start?: string; end?: string }) =>
    [...analyticsKeys.all, "geography", siteId, range] as const,
  referrers: (siteId: string, range?: { start?: string; end?: string }) =>
    [...analyticsKeys.all, "referrers", siteId, range] as const,
  pages: (siteId: string, range?: { start?: string; end?: string }) =>
    [...analyticsKeys.all, "pages", siteId, range] as const,
  devices: (siteId: string, range?: { start?: string; end?: string }) =>
    [...analyticsKeys.all, "devices", siteId, range] as const,
  // Domain analytics keys
  domainSummary: (domainId: string, range?: { start?: string; end?: string }) =>
    [...analyticsKeys.all, "domain", "summary", domainId, range] as const,
  domainVisitors: (domainId: string, range?: { start?: string; end?: string; interval?: string }) =>
    [...analyticsKeys.all, "domain", "visitors", domainId, range] as const,
  domainGeography: (domainId: string, range?: { start?: string; end?: string }) =>
    [...analyticsKeys.all, "domain", "geography", domainId, range] as const,
};

export function useSiteAnalyticsSummary(siteId: string, options?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: analyticsKeys.summary(siteId, options),
    queryFn: async () => {
      const response = await siteAnalyticsApi.getSummary(siteId, options);
      return response;
    },
    enabled: !!siteId,
  });
}

export function useSiteVisitors(siteId: string, options?: { start?: string; end?: string; interval?: string }) {
  return useQuery({
    queryKey: analyticsKeys.visitors(siteId, options),
    queryFn: async () => {
      const response = await siteAnalyticsApi.getVisitors(siteId, options);
      return response.data;
    },
    enabled: !!siteId,
  });
}

export function useSiteGeography(siteId: string, options?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: analyticsKeys.geography(siteId, options),
    queryFn: async () => {
      const response = await siteAnalyticsApi.getGeography(siteId, options);
      return response.countries;
    },
    enabled: !!siteId,
  });
}

export function useSiteReferrers(siteId: string, options?: { start?: string; end?: string; limit?: string }) {
  return useQuery({
    queryKey: analyticsKeys.referrers(siteId, options),
    queryFn: async () => {
      const response = await siteAnalyticsApi.getReferrers(siteId, options);
      return response.referrers;
    },
    enabled: !!siteId,
  });
}

export function useSitePages(siteId: string, options?: { start?: string; end?: string; limit?: string }) {
  return useQuery({
    queryKey: analyticsKeys.pages(siteId, options),
    queryFn: async () => {
      const response = await siteAnalyticsApi.getPages(siteId, options);
      return response.pages;
    },
    enabled: !!siteId,
  });
}

export function useSiteDevices(siteId: string, options?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: analyticsKeys.devices(siteId, options),
    queryFn: async () => {
      const response = await siteAnalyticsApi.getDevices(siteId, options);
      return response;
    },
    enabled: !!siteId,
  });
}

// Domain Analytics Hooks
export function useDomainAnalyticsSummary(domainId: string, options?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: analyticsKeys.domainSummary(domainId, options),
    queryFn: async () => {
      const response = await siteAnalyticsApi.getDomainSummary(domainId, options);
      return response;
    },
    enabled: !!domainId,
  });
}

export function useDomainVisitors(domainId: string, options?: { start?: string; end?: string; interval?: string }) {
  return useQuery({
    queryKey: analyticsKeys.domainVisitors(domainId, options),
    queryFn: async () => {
      const response = await siteAnalyticsApi.getDomainVisitors(domainId, options);
      return response.data;
    },
    enabled: !!domainId,
  });
}

export function useDomainGeography(domainId: string, options?: { start?: string; end?: string }) {
  return useQuery({
    queryKey: analyticsKeys.domainGeography(domainId, options),
    queryFn: async () => {
      const response = await siteAnalyticsApi.getDomainGeography(domainId, options);
      return response.countries;
    },
    enabled: !!domainId,
  });
}

export function useSiteDomains(siteId: string) {
  return useQuery({
    queryKey: [...siteKeys.detail(siteId), "domains"] as const,
    queryFn: async () => {
      const response = await siteDomainsApi.listBySite(siteId);
      return response.siteDomains
        .filter((sd) => sd.isActive)
        .map((sd) => sd.domain)
        .filter((d): d is Domain => d !== undefined);
    },
    enabled: !!siteId,
  });
}

export const s3ProviderKeys = {
  all: ["s3Providers"] as const,
  lists: () => [...s3ProviderKeys.all, "list"] as const,
  details: () => [...s3ProviderKeys.all, "detail"] as const,
  detail: (id: string) => [...s3ProviderKeys.details(), id] as const,
  usage: (id: string) => [...s3ProviderKeys.detail(id), "usage"] as const,
};

export function useS3Providers() {
  return useQuery({
    queryKey: s3ProviderKeys.lists(),
    queryFn: async () => {
      const response = await s3ProvidersApi.list();
      return response.providers;
    },
  });
}

export function useS3Provider(id: string) {
  return useQuery({
    queryKey: s3ProviderKeys.detail(id),
    queryFn: async () => {
      const response = await s3ProvidersApi.get(id);
      return response.provider;
    },
    enabled: !!id,
  });
}

export function useCreateS3Provider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateS3ProviderData) => s3ProvidersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: s3ProviderKeys.lists() });
    },
  });
}

export function useUpdateS3Provider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateS3ProviderData }) =>
      s3ProvidersApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: s3ProviderKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: s3ProviderKeys.lists() });
    },
  });
}

export function useDeleteS3Provider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => s3ProvidersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: s3ProviderKeys.lists() });
    },
  });
}

export function useTestS3Provider() {
  return useMutation({
    mutationFn: (id: string) => s3ProvidersApi.test(id),
  });
}

export function useSetDefaultS3Provider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => s3ProvidersApi.setDefault(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: s3ProviderKeys.lists() });
    },
  });
}

export function useS3ProviderUsage(id: string) {
  return useQuery({
    queryKey: s3ProviderKeys.usage(id),
    queryFn: async () => {
      const response = await s3ProvidersApi.getUsage(id);
      return response.usage;
    },
    enabled: !!id,
  });
}
