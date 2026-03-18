import { createClient, ClickHouseClient } from "@clickhouse/client";
import { getClickHouseUrl, getClickHousePassword } from "@uni-proxy-manager/shared/config";

let client: ClickHouseClient | null = null;

export function getClickHouseClient(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: getClickHouseUrl(),
      username: "analytics",
      password: getClickHousePassword(),
      database: "analytics",
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 0,
      },
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
