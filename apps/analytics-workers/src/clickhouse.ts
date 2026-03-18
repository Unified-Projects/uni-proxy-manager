import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getClickHouseUrl, getClickHousePassword } from "@uni-proxy-manager/shared/config";

let client: ClickHouseClient | null = null;

export function getClickHouseClient(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: getClickHouseUrl(),
      username: "analytics",
      password: getClickHousePassword(),
      database: "analytics",
    });
  }
  return client;
}

export async function closeClickHouseClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
