import { Hono } from "hono";
import { sendHaproxySocketCommand } from "@uni-proxy-manager/shared/haproxy";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const app = new Hono();

const runtimeCommandSchema = z.object({
  command: z.string().min(1).max(500),
});

/**
 * POST /api/haproxy/runtime
 * Execute a raw command on the local HAProxy stats socket.
 * This endpoint is called by the cluster master to fan out runtime commands.
 */
app.post("/", zValidator("json", runtimeCommandSchema), async (c) => {
  const { command } = c.req.valid("json");

  // Basic command sanitisation: only allow known safe command prefixes
  const allowedPrefixes = [
    "set server ",
    "disable server ",
    "enable server ",
    "set weight ",
    "set maxconn server ",
    "show info",
    "show stat",
    "show servers state",
    "show backend",
  ];

  const isAllowed = allowedPrefixes.some((prefix) =>
    command.toLowerCase().startsWith(prefix.toLowerCase())
  );

  if (!isAllowed) {
    return c.json({ error: "Command not permitted" }, 403);
  }

  try {
    const output = await sendHaproxySocketCommand(command);
    return c.json({ output });
  } catch (error) {
    console.error("[HAProxyRuntime] Socket command failed:", error);
    return c.json(
      { error: error instanceof Error ? error.message : "Socket command failed" },
      500
    );
  }
});

export default app;
