import { Hono } from "hono";
import { db } from "@uni-proxy-manager/database";
import { clusterNodes } from "@uni-proxy-manager/database/schema";
import { ne } from "drizzle-orm";
import { sendHaproxySocketCommand, getHaproxyInfo, getHaproxyStats } from "@uni-proxy-manager/shared/haproxy";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const app = new Hono();

interface NodeCommandResult {
  nodeId: string;
  nodeName: string;
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Fan a HAProxy socket command out to the local node plus all registered remote nodes.
 */
async function fanOutCommand(command: string): Promise<NodeCommandResult[]> {
  const results: NodeCommandResult[] = [];

  // Execute locally first
  try {
    const output = await sendHaproxySocketCommand(command);
    results.push({ nodeId: "local", nodeName: "local", success: true, output });
  } catch (err) {
    results.push({
      nodeId: "local",
      nodeName: "local",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fetch all remote nodes
  const remoteNodes = await db.query.clusterNodes.findMany({
    where: ne(clusterNodes.isLocal, true),
  });

  await Promise.all(
    remoteNodes.map(async (node) => {
      try {
        const response = await fetch(`${node.apiUrl}/api/haproxy/runtime`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${node.apiKey}`,
          },
          body: JSON.stringify({ command }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: "unknown" }));
          throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
        }

        const data = (await response.json()) as { output?: string };
        results.push({ nodeId: node.id, nodeName: node.name, success: true, output: data.output });
      } catch (err) {
        results.push({
          nodeId: node.id,
          nodeName: node.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  return results;
}

const serverActionSchema = z.object({
  backendName: z.string().min(1),
  serverName: z.string().min(1),
});

const weightSchema = serverActionSchema.extend({
  weight: z.number().int().min(0).max(256),
});

const maxconnSchema = serverActionSchema.extend({
  maxconn: z.number().int().min(0),
});

// POST /runtime/server/enable
app.post("/server/enable", zValidator("json", serverActionSchema), async (c) => {
  const { backendName, serverName } = c.req.valid("json");
  const command = `enable server ${backendName}/${serverName}`;
  const results = await fanOutCommand(command);
  return c.json({ command, results });
});

// POST /runtime/server/disable
app.post("/server/disable", zValidator("json", serverActionSchema), async (c) => {
  const { backendName, serverName } = c.req.valid("json");
  const command = `disable server ${backendName}/${serverName}`;
  const results = await fanOutCommand(command);
  return c.json({ command, results });
});

// POST /runtime/server/drain
app.post("/server/drain", zValidator("json", serverActionSchema), async (c) => {
  const { backendName, serverName } = c.req.valid("json");
  const command = `set server ${backendName}/${serverName} state drain`;
  const results = await fanOutCommand(command);
  return c.json({ command, results });
});

// POST /runtime/server/weight
app.post("/server/weight", zValidator("json", weightSchema), async (c) => {
  const { backendName, serverName, weight } = c.req.valid("json");
  const command = `set weight ${backendName}/${serverName} ${weight}`;
  const results = await fanOutCommand(command);
  return c.json({ command, results });
});

// POST /runtime/server/maxconn
app.post("/server/maxconn", zValidator("json", maxconnSchema), async (c) => {
  const { backendName, serverName, maxconn } = c.req.valid("json");
  const command = `set maxconn server ${backendName}/${serverName} ${maxconn}`;
  const results = await fanOutCommand(command);
  return c.json({ command, results });
});

// GET /runtime/info — aggregate show info from all nodes
app.get("/info", async (c) => {
  interface NodeInfo {
    nodeId: string;
    nodeName: string;
    success: boolean;
    info?: Record<string, string | number>;
    error?: string;
  }
  const nodeInfoResults: NodeInfo[] = [];

  // Local
  try {
    const info = await getHaproxyInfo();
    nodeInfoResults.push({ nodeId: "local", nodeName: "local", success: true, info });
  } catch (err) {
    nodeInfoResults.push({
      nodeId: "local",
      nodeName: "local",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Remote nodes
  const remoteNodes = await db.query.clusterNodes.findMany({
    where: ne(clusterNodes.isLocal, true),
  });

  await Promise.all(
    remoteNodes.map(async (node) => {
      try {
        const response = await fetch(`${node.apiUrl}/api/haproxy/runtime`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${node.apiKey}`,
          },
          body: JSON.stringify({ command: "show info" }),
          signal: AbortSignal.timeout(8_000),
        });
        const data = (await response.json()) as { output?: string };
        nodeInfoResults.push({
          nodeId: node.id,
          nodeName: node.name,
          success: true,
          info: { raw: data.output ?? "" } as Record<string, string | number>,
        });
      } catch (err) {
        nodeInfoResults.push({
          nodeId: node.id,
          nodeName: node.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  return c.json({ nodes: nodeInfoResults });
});

// GET /runtime/stats — aggregate show stat from all nodes
app.get("/stats", async (c) => {
  interface NodeStats {
    nodeId: string;
    nodeName: string;
    success: boolean;
    stats?: unknown;
    error?: string;
  }
  const nodeStatsResults: NodeStats[] = [];

  // Local
  try {
    const stats = await getHaproxyStats();
    nodeStatsResults.push({ nodeId: "local", nodeName: "local", success: true, stats });
  } catch (err) {
    nodeStatsResults.push({
      nodeId: "local",
      nodeName: "local",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Remote nodes
  const remoteNodes = await db.query.clusterNodes.findMany({
    where: ne(clusterNodes.isLocal, true),
  });

  await Promise.all(
    remoteNodes.map(async (node) => {
      try {
        const response = await fetch(`${node.apiUrl}/api/haproxy/runtime`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${node.apiKey}`,
          },
          body: JSON.stringify({ command: "show stat" }),
          signal: AbortSignal.timeout(8_000),
        });
        const data = (await response.json()) as { output?: string };
        nodeStatsResults.push({
          nodeId: node.id,
          nodeName: node.name,
          success: true,
          stats: { raw: data.output ?? "" },
        });
      } catch (err) {
        nodeStatsResults.push({
          nodeId: node.id,
          nodeName: node.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  return c.json({ nodes: nodeStatsResults });
});

export default app;
