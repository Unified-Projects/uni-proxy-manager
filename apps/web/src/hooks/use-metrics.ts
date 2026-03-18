import { useQuery } from "@tanstack/react-query";
import type { TrafficDataPoint } from "@/types/metrics";

interface LiveMetricsDomain {
  domainId: string;
  hostname: string;
  currentConnections: number;
  requestRate: number;
}

interface LiveMetricsResponse {
  domains: LiveMetricsDomain[];
}

interface DomainMetricsResponse {
  metrics: TrafficDataPoint[];
  uniqueVisitorsTotal: number;
}

interface TopDomain {
  domainId: string;
  totalRequests: number;
}

interface DashboardMetricsResponse {
  totalRequestsToday: number;
  totalBytesToday: number;
  uniqueVisitorsToday: number;
  topDomains: TopDomain[];
  recentTraffic: TrafficDataPoint[];
}

const metricsKeys = {
  all: ["metrics"] as const,
  live: () => [...metricsKeys.all, "live"] as const,
  domain: (domainId: string, interval: string) =>
    [...metricsKeys.all, "domain", domainId, interval] as const,
  dashboard: () => [...metricsKeys.all, "dashboard"] as const,
};

export function useLiveMetrics() {
  return useQuery<LiveMetricsResponse>({
    queryKey: metricsKeys.live(),
    queryFn: async () => {
      const res = await fetch("/api/metrics/live");
      if (!res.ok) throw new Error("Failed to fetch live metrics");
      return res.json();
    },
    refetchInterval: 60000, // Every minute
  });
}

export function useDomainMetrics(
  domainId: string,
  interval: "hour" | "day" | "week" = "hour"
) {
  // Calculate appropriate limit based on interval
  const limitMap = {
    hour: 100,     // 60 minutes, 100 is enough
    day: 1500,     // 1440 minutes (24h), plus buffer
    week: 10500,   // 10080 minutes (7d), plus buffer
  };

  return useQuery<DomainMetricsResponse>({
    queryKey: metricsKeys.domain(domainId, interval),
    queryFn: async () => {
      const limit = limitMap[interval];
      const res = await fetch(
        `/api/metrics/domain/${domainId}?interval=${interval}&limit=${limit}`
      );
      if (!res.ok) throw new Error("Failed to fetch domain metrics");
      return res.json();
    },
    refetchInterval: 60000,
  });
}

export function useDashboardMetrics() {
  return useQuery<DashboardMetricsResponse>({
    queryKey: metricsKeys.dashboard(),
    queryFn: async () => {
      const res = await fetch("/api/metrics/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard metrics");
      return res.json();
    },
    refetchInterval: 60000,
  });
}
