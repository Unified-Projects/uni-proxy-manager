import { useQuery } from "@tanstack/react-query";
import { extensionsApi } from "@/lib/api";

export const extensionKeys = {
  all: ["extensions"] as const,
  status: () => [...extensionKeys.all, "status"] as const,
};

export function useExtensions() {
  return useQuery({
    queryKey: extensionKeys.status(),
    queryFn: async () => {
      const response = await extensionsApi.status();
      return response.extensions;
    },
    staleTime: Infinity, // Never refetch - extensions don't change at runtime
    gcTime: Infinity,
  });
}

export function useSitesExtensionEnabled() {
  const { data: extensions, isLoading } = useExtensions();
  return {
    enabled: extensions?.sites ?? false,
    isLoading,
  };
}

export function usePomeriumExtensionEnabled() {
  const { data: extensions, isLoading } = useExtensions();
  return {
    enabled: extensions?.pomerium ?? false,
    isLoading,
  };
}

export function useAnalyticsExtensionEnabled() {
  const { data: extensions, isLoading } = useExtensions();
  return {
    enabled: extensions?.analytics ?? false,
    isLoading,
  };
}
