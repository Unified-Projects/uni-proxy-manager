import { cpSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Copy SQL migration files to dist
const srcMigrations = join(root, "src", "clickhouse", "migrations");
const distMigrations = join(root, "dist", "clickhouse", "migrations");

if (existsSync(srcMigrations)) {
  mkdirSync(distMigrations, { recursive: true });
  cpSync(srcMigrations, distMigrations, { recursive: true });
  console.log("Copied ClickHouse migrations to dist/");
}

// Minify JS script files (bootstrap.js, tracker.js) to dist
const srcScripts = join(root, "src", "scripts");
const distScripts = join(root, "dist", "scripts");

if (existsSync(srcScripts)) {
  mkdirSync(distScripts, { recursive: true });
  for (const file of ["bootstrap.js", "tracker.js"]) {
    const src = join(srcScripts, file);
    if (existsSync(src)) {
      const result = await Bun.build({
        entrypoints: [src],
        minify: true,
      });
      if (result.success && result.outputs.length > 0) {
        await Bun.write(join(distScripts, file), result.outputs[0]);
      } else {
        console.error(`Failed to minify ${file}, copying as-is`);
        cpSync(src, join(distScripts, file));
      }
    }
  }
  console.log("Minified tracker scripts to dist/");
}
