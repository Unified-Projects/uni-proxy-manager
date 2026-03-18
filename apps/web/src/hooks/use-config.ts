import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { configApi } from "@/lib/api";

export interface AcmeConfig {
  email: string;
  staging: boolean;
  directoryUrl: string;
}

export function useAcmeConfig() {
  return useQuery({
    queryKey: ["acme-config"],
    queryFn: () => configApi.getAcme(),
  });
}

export function useUpdateAcmeConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { email: string }) => configApi.updateAcme(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acme-config"] });
    },
  });
}
