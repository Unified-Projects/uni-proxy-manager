import type { ClickHouseClient } from "@clickhouse/client";
import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Split SQL text into individual statements, handling quoted strings
 * and comments so that semicolons inside them are not treated as
 * statement terminators.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Handle line comments
    if (!inSingleQuote && !inDoubleQuote && !inBlockComment && ch === "-" && next === "-") {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      current += ch;
      continue;
    }

    // Handle block comments
    if (!inSingleQuote && !inDoubleQuote && !inLineComment && ch === "/" && next === "*") {
      inBlockComment = true;
      current += ch;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    // Handle single quotes (with '' escaping)
    if (!inDoubleQuote && ch === "'") {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }

    // Handle double quotes
    if (!inSingleQuote && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    // Statement terminator
    if (!inSingleQuote && !inDoubleQuote && ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  // Handle last statement (no trailing semicolon)
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);

  return statements;
}

export async function runClickHouseMigrations(client: ClickHouseClient): Promise<void> {
  // Create migrations tracking table
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS _migrations (
      name String,
      applied_at DateTime DEFAULT now()
    ) ENGINE = MergeTree() ORDER BY name`,
  });

  // Get already-applied migrations
  const applied = await client.query({
    query: "SELECT name FROM _migrations",
    format: "JSONEachRow",
  });
  const appliedRows = await applied.json<{ name: string }>();
  const appliedSet = new Set(appliedRows.map(r => r.name));

  // Read and apply pending migrations in order
  const migrationsDir = join(__dirname, "migrations");
  const files = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    console.log(`[Analytics] Applying migration: ${file}`);
    const sql = await readFile(join(migrationsDir, file), "utf-8");

    // Split on semicolons, respecting quoted strings and comments.
    const statements = splitSqlStatements(sql);
    for (const stmt of statements) {
      await client.command({ query: stmt });
    }

    await client.insert({
      table: "_migrations",
      values: [{ name: file }],
      format: "JSONEachRow",
    });

    console.log(`[Analytics] Migration applied: ${file}`);
  }
}
