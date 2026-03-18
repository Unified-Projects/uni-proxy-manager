import { useQuery } from "@tanstack/react-query";
import { analyticsDataApi } from "@/lib/api";
import type { AnalyticsQueryParams } from "@/lib/types";

export const analyticsDataKeys = {
  all: ["analyticsData"] as const,
  summary: (configId: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "summary", configId, params] as const,
  timeseries: (configId: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "timeseries", configId, params] as const,
  pages: (configId: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "pages", configId, params] as const,
  referrers: (configId: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "referrers", configId, params] as const,
  geography: (configId: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "geography", configId, params] as const,
  devices: (configId: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "devices", configId, params] as const,
  events: (configId: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "events", configId, params] as const,
  eventDetail: (configId: string, eventName: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "eventDetail", configId, eventName, params] as const,
  utm: (configId: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "utm", configId, params] as const,
  live: (configId: string) =>
    [...analyticsDataKeys.all, "live", configId] as const,
  export: (configId: string, params?: AnalyticsQueryParams) =>
    [...analyticsDataKeys.all, "export", configId, params] as const,
};

export function useAnalyticsSummary(configId: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.summary(configId, params),
    queryFn: async () => {
      const response = await analyticsDataApi.getSummary(configId, params);
      return response;
    },
    enabled: !!configId,
  });
}

export function useAnalyticsTimeseries(configId: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.timeseries(configId, params),
    queryFn: async () => {
      const response = await analyticsDataApi.getTimeseries(configId, params);
      return response.timeseries;
    },
    enabled: !!configId,
  });
}

export function useAnalyticsPages(configId: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.pages(configId, params),
    queryFn: async () => {
      const response = await analyticsDataApi.getPages(configId, params);
      return response;
    },
    enabled: !!configId,
  });
}

export function useAnalyticsReferrers(configId: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.referrers(configId, params),
    queryFn: async () => {
      const response = await analyticsDataApi.getReferrers(configId, params);
      return response.referrers;
    },
    enabled: !!configId,
  });
}

export function useAnalyticsGeography(configId: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.geography(configId, params),
    queryFn: async () => {
      const response = await analyticsDataApi.getGeography(configId, params);
      return response.countries;
    },
    enabled: !!configId,
  });
}

export function useAnalyticsDevices(configId: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.devices(configId, params),
    queryFn: async () => {
      const response = await analyticsDataApi.getDevices(configId, params);
      return response;
    },
    enabled: !!configId,
  });
}

export function useAnalyticsEvents(configId: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.events(configId, params),
    queryFn: async () => {
      const response = await analyticsDataApi.getEvents(configId, params);
      return response.events;
    },
    enabled: !!configId,
  });
}

export function useAnalyticsEventDetail(configId: string, eventName: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.eventDetail(configId, eventName, params),
    queryFn: async () => {
      const response = await analyticsDataApi.getEventDetail(configId, eventName, params);
      return response;
    },
    enabled: !!configId && !!eventName,
  });
}

export function useAnalyticsUTM(configId: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.utm(configId, params),
    queryFn: async () => {
      const response = await analyticsDataApi.getUTM(configId, params);
      return response;
    },
    enabled: !!configId,
  });
}

export function useAnalyticsLive(configId: string) {
  return useQuery({
    queryKey: analyticsDataKeys.live(configId),
    queryFn: async () => {
      const response = await analyticsDataApi.getLive(configId);
      return response;
    },
    enabled: !!configId,
    refetchInterval: 5000,
  });
}

export function useAnalyticsExport(configId: string, params?: AnalyticsQueryParams) {
  return useQuery({
    queryKey: analyticsDataKeys.export(configId, params),
    queryFn: async () => {
      const response = await analyticsDataApi.exportJson(configId, params);
      return response.data;
    },
    enabled: false, // Only fetch on demand
  });
}
