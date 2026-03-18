import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { clusterApi } from "@/lib/api";
import type { CreateClusterNodeData, UpdateClusterNodeData } from "@/lib/types";

export const clusterKeys = {
  all: ["cluster"] as const,
  nodes: () => [...clusterKeys.all, "nodes"] as const,
  node: (id: string) => [...clusterKeys.all, "node", id] as const,
};

export function useClusterNodes() {
  return useQuery({
    queryKey: clusterKeys.nodes(),
    queryFn: () => clusterApi.list().then((r) => r.nodes),
    refetchInterval: 15_000,
  });
}

export function useClusterNode(id: string) {
  return useQuery({
    queryKey: clusterKeys.node(id),
    queryFn: () => clusterApi.get(id).then((r) => r.node),
    enabled: Boolean(id),
  });
}

export function useCreateClusterNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateClusterNodeData) => clusterApi.create(data).then((r) => r.node),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.nodes() });
    },
  });
}

export function useUpdateClusterNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateClusterNodeData }) =>
      clusterApi.update(id, data).then((r) => r.node),
    onSuccess: (_node, { id }) => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.nodes() });
      queryClient.invalidateQueries({ queryKey: clusterKeys.node(id) });
    },
  });
}

export function useDeleteClusterNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clusterApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.nodes() });
    },
  });
}

export function useSyncClusterNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clusterApi.sync(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.nodes() });
    },
  });
}

export function useSyncAllClusterNodes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clusterApi.syncAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.nodes() });
    },
  });
}

export function useCheckClusterNodeStatus() {
  return useMutation({
    mutationFn: (id: string) => clusterApi.checkStatus(id),
  });
}
