"use client";

import { useEffect, useState, useRef } from "react";

interface UseDeploymentStatusSSEResult {
  status: string;
  error: string | null;
  isConnected: boolean;
}

/**
 * SSE hook for real-time deployment status updates.
 * Only connects for in-progress deployments (pending, building, deploying).
 */
export function useDeploymentStatusSSE(
  deploymentId: string,
  initialStatus: string,
  enabled = true
): UseDeploymentStatusSSEResult {
  const [status, setStatus] = useState<string>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Determine if we should connect based on status
  const isTerminalStatus = ["live", "failed", "cancelled", "rolled_back"].includes(initialStatus);
  const shouldConnect = enabled && !isTerminalStatus;

  useEffect(() => {
    // Update status if initial status changes (e.g., from parent refetch)
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!deploymentId || !shouldConnect) {
      return;
    }

    const createConnection = () => {
      // Clean up existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(`/api/deployments/${deploymentId}/status-stream`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.addEventListener("status", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status) {
            setStatus(data.status);
            // Close connection on terminal status
            if (["live", "failed", "cancelled", "rolled_back"].includes(data.status)) {
              eventSource.close();
              setIsConnected(false);
            }
          }
          if (data.error) {
            setError(data.error);
          }
        } catch (e) {
          console.error("Failed to parse status event:", e);
        }
      });

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource.close();

        // Attempt reconnection after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          createConnection();
        }, 3000);
      };
    };

    createConnection();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [deploymentId, shouldConnect]);

  return { status, error, isConnected };
}
