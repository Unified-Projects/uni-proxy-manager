"use client";

import { useEffect, useState, useRef } from "react";

interface UseDeploymentLogsSSEOptions {
  enabled?: boolean;
}

interface UseDeploymentLogsSSEResult {
  logs: string[];
  status: string;
  isComplete: boolean;
  isConnected: boolean;
  error: string | null;
}

export function useDeploymentLogsSSE(
  deploymentId: string,
  options: UseDeploymentLogsSSEOptions = {}
): UseDeploymentLogsSSEResult {
  const { enabled = true } = options;
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("pending");
  const [isComplete, setIsComplete] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCompleteRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => {
    isCompleteRef.current = isComplete;
  }, [isComplete]);

  useEffect(() => {
    const createConnection = () => {
      if (!deploymentId || !enabled || isCompleteRef.current) return;

      // Clean up existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(`/api/deployments/${deploymentId}/logs`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.addEventListener("log", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.line) {
            setLogs((prev) => {
              // Deduplicate logs to handle reconnection resending buffered logs
              // Each log line has a timestamp prefix like [2024-01-01T00:00:00.000Z]
              // Use the full line as the key since it includes the timestamp
              if (prev.length > 0 && prev[prev.length - 1] === data.line) {
                return prev; // Skip exact duplicate of last line
              }
              // Check if this line already exists (for reconnection scenarios)
              if (prev.includes(data.line)) {
                return prev; // Skip duplicate
              }
              return [...prev, data.line];
            });
          }
        } catch (e) {
          console.error("Failed to parse log event:", e);
        }
      });

      eventSource.addEventListener("status", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status) {
            setStatus(data.status);
            if (["live", "failed", "cancelled", "rolled_back"].includes(data.status)) {
              setIsComplete(true);
              isCompleteRef.current = true;
              eventSource.close();
              setIsConnected(false);
            }
          }
        } catch (e) {
          console.error("Failed to parse status event:", e);
        }
      });

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource.close();

        // Attempt reconnection after 3 seconds if not complete
        if (!isCompleteRef.current) {
          // Don't set error - SSE reconnection is normal and handled automatically
          // The deduplication logic handles any logs resent by the server
          reconnectTimeoutRef.current = setTimeout(() => {
            // Don't clear logs - keep existing and deduplicate new ones
            setError(null);
            connectRef.current();
          }, 3000);
        }
      };
    };

    // Store the connect function in a ref for reconnection
    connectRef.current = createConnection;

    // Initial connection
    createConnection();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [deploymentId, enabled]);

  return {
    logs,
    status,
    isComplete,
    isConnected,
    error,
  };
}
