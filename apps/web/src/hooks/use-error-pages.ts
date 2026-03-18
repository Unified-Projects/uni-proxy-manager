import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { errorPagesApi } from "@/lib/api";
import type { CreateErrorPageData } from "@/lib/types";

export const errorPageKeys = {
  all: ["error-pages"] as const,
  lists: () => [...errorPageKeys.all, "list"] as const,
  list: () => [...errorPageKeys.lists()] as const,
  details: () => [...errorPageKeys.all, "detail"] as const,
  detail: (id: string) => [...errorPageKeys.details(), id] as const,
};

export function useErrorPages() {
  return useQuery({
    queryKey: errorPageKeys.list(),
    queryFn: async () => {
      const response = await errorPagesApi.list();
      // Filter out maintenance type pages - those are handled separately
      return response.errorPages.filter(
        (page: { type: string }) => page.type !== "maintenance"
      );
    },
  });
}

export function useErrorPage(id: string) {
  return useQuery({
    queryKey: errorPageKeys.detail(id),
    queryFn: async () => {
      const response = await errorPagesApi.get(id);
      return response.errorPage;
    },
    enabled: !!id,
  });
}

export function useCreateErrorPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateErrorPageData) => errorPagesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: errorPageKeys.lists() });
    },
  });
}

export function useUploadErrorPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      errorPagesApi.upload(id, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: errorPageKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: errorPageKeys.lists() });
    },
  });
}

export function useDeleteErrorPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => errorPagesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: errorPageKeys.lists() });
    },
  });
}

export function getErrorPagePreviewUrl(id: string): string {
  return errorPagesApi.preview(id);
}

export function getErrorPageDownloadUrl(id: string): string {
  return errorPagesApi.download(id);
}
