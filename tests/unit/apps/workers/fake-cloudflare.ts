/**
 * In-memory stand-in for the Cloudflare DNS API and Cloudflare DNS-over-HTTPS
 * resolver, used by the DNS-01 unit tests in place of global fetch.
 */

import { vi } from "vitest";

export interface FakeTxtRecord {
  id: string;
  name: string;
  content: string;
}

export interface FakeCloudflare {
  fetch: ReturnType<typeof vi.fn<typeof fetch>>;
  /** TXT records currently held by the fake zone. */
  records: Map<string, FakeTxtRecord>;
  /** Record ids that received a DELETE request. */
  deletedIds: string[];
  /** Values the resolver does not return yet, to simulate propagation delay. */
  unpropagated: Set<string>;
  /** Adds a record directly to the zone, as if created by another process. */
  seed(name: string, content: string): FakeTxtRecord;
  /** Values the resolver currently returns for a name. */
  publishedValues(name: string): string[];
}

export function createFakeCloudflare(zoneName = "example.com", zoneId = "zone-1"): FakeCloudflare {
  const records = new Map<string, FakeTxtRecord>();
  const deletedIds: string[] = [];
  const unpropagated = new Set<string>();
  let nextId = 1;

  const seed = (name: string, content: string): FakeTxtRecord => {
    const record = { id: `record-${nextId++}`, name, content };
    records.set(record.id, record);
    return record;
  };

  const publishedValues = (name: string): string[] =>
    [...records.values()]
      .filter((record) => record.name === name && !unpropagated.has(record.content))
      .map((record) => record.content);

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? "GET";

    if (url.hostname === "cloudflare-dns.com") {
      const answers = publishedValues(url.searchParams.get("name") ?? "").map((value) => ({
        data: `"${value}"`,
      }));
      return Response.json(answers.length > 0 ? { Status: 0, Answer: answers } : { Status: 0 });
    }

    if (url.pathname === "/client/v4/zones") {
      const matches = url.searchParams.get("name") === zoneName;
      return Response.json({
        success: true,
        result: matches ? [{ id: zoneId, name: zoneName }] : [],
      });
    }

    const recordsPath = `/client/v4/zones/${zoneId}/dns_records`;

    if (url.pathname === recordsPath && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { name: string; content: string };
      const record = seed(body.name, body.content);
      return Response.json({ success: true, result: record });
    }

    if (url.pathname === recordsPath && method === "GET") {
      const name = url.searchParams.get("name");
      const result = [...records.values()]
        .filter((record) => record.name === name)
        .map((record) => ({ ...record, content: `"${record.content}"` }));
      return Response.json({ success: true, result });
    }

    if (url.pathname.startsWith(`${recordsPath}/`) && method === "DELETE") {
      const id = url.pathname.substring(recordsPath.length + 1);
      deletedIds.push(id);
      if (!records.delete(id)) {
        return Response.json({ success: false, result: null }, { status: 404 });
      }
      return Response.json({ success: true, result: { id } });
    }

    return Response.json({ success: false, result: null }, { status: 404 });
  });

  return {
    fetch: fetchMock,
    records,
    deletedIds,
    unpropagated,
    seed,
    publishedValues,
  };
}
