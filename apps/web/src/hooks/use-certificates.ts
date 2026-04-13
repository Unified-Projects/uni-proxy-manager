import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { certificatesApi } from "@/lib/api";
import type {
  RequestCertificateData,
  UpdateCertificateData,
} from "@/lib/types";
import { domainKeys } from "./use-domains";

export const certificateKeys = {
  all: ["certificates"] as const,
  lists: () => [...certificateKeys.all, "list"] as const,
  list: (domainId?: string) =>
    [...certificateKeys.lists(), { domainId }] as const,
  details: () => [...certificateKeys.all, "detail"] as const,
  detail: (id: string) => [...certificateKeys.details(), id] as const,
};

export function useCertificates(domainId?: string) {
  return useQuery({
    queryKey: certificateKeys.list(domainId),
    queryFn: async () => {
      const response = await certificatesApi.list(domainId);
      return response.certificates;
    },
  });
}

export function useCertificate(id: string) {
  return useQuery({
    queryKey: certificateKeys.detail(id),
    queryFn: async () => {
      const response = await certificatesApi.get(id);
      return response.certificate;
    },
    enabled: !!id,
  });
}

export function formatCertificateAltNamesInput(
  altNames: string[] | null | undefined,
) {
  return (altNames ?? []).join("\n");
}

export function parseCertificateAltNamesInput(
  input: string,
  commonName?: string | null,
) {
  const normalizedCommonName = commonName?.trim().toLowerCase();
  const seen = new Set<string>();

  return input
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value) => {
      const normalizedValue = value.toLowerCase();

      if (normalizedValue === normalizedCommonName) {
        return false;
      }

      if (seen.has(normalizedValue)) {
        return false;
      }

      seen.add(normalizedValue);
      return true;
    });
}

export function useRequestCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: RequestCertificateData) => certificatesApi.request(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: certificateKeys.lists() });
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: domainKeys.detail(variables.domainId),
      });
    },
  });
}

export function useUpdateCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCertificateData }) =>
      certificatesApi.update(id, data),
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({
        queryKey: certificateKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: certificateKeys.lists() });
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: domainKeys.detail(response.certificate.domainId),
      });
    },
  });
}

export function useRenewCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => certificatesApi.renew(id),
    onSuccess: (response, id) => {
      queryClient.invalidateQueries({ queryKey: certificateKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: certificateKeys.lists() });
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
      if (response.certificate?.domainId) {
        queryClient.invalidateQueries({
          queryKey: domainKeys.detail(response.certificate.domainId),
        });
      }
    },
  });
}

export function useDeleteCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => certificatesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificateKeys.lists() });
      queryClient.invalidateQueries({ queryKey: domainKeys.lists() });
    },
  });
}
