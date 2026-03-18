import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readFileSecret,
  resetEnvCache,
  getDatabaseUrl,
  getAcmeConfig,
  getCorsConfig,
} from "../src/config/env.js";

const ORIGINAL_ENV = { ...process.env };

describe("env helpers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "env-tests-"));
    process.env = { ...ORIGINAL_ENV };
    resetEnvCache();
  });

  afterEach(() => {
    resetEnvCache();
    process.env = { ...ORIGINAL_ENV };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads secrets from _FILE variants when present", () => {
    const secretPath = join(tmpDir, "db.txt");
    writeFileSync(secretPath, "postgres://from-file\n", "utf-8");
    process.env.UNI_PROXY_MANAGER_DB_URL_FILE = secretPath;
    delete process.env.UNI_PROXY_MANAGER_DB_URL;

    const value = readFileSecret("UNI_PROXY_MANAGER_DB_URL");
    expect(value).toBe("postgres://from-file");
  });

  it("throws when database URLs are missing", () => {
    delete process.env.UNI_PROXY_MANAGER_DB_URL;
    delete process.env.DATABASE_URL;

    expect(() => getDatabaseUrl()).toThrow(/DATABASE_URL/);
  });

  it("builds ACME config with staging defaults", () => {
    process.env.UNI_PROXY_MANAGER_ACME_STAGING = "true";
    process.env.UNI_PROXY_MANAGER_ACME_EMAIL = "admin@example.com";
    resetEnvCache();

    const acme = getAcmeConfig();
    expect(acme.staging).toBe(true);
    expect(acme.email).toBe("admin@example.com");
    expect(acme.directoryUrl).toContain("acme-staging");
  });

  it("merges and de-duplicates CORS origins", () => {
    process.env.UNI_PROXY_MANAGER_URL = "https://app.example.com/";
    process.env.UNI_PROXY_MANAGER_CORS_ORIGINS = "https://api.example.com, https://app.example.com";
    resetEnvCache();

    const cors = getCorsConfig();
    expect(cors.enabled).toBe(true);
    expect(cors.origins).toContain("https://app.example.com");
    expect(cors.origins).toContain("http://localhost:3000");
    expect(cors.origins).toContain("https://api.example.com");
    // should not include duplicates
    expect(cors.origins.filter((o) => o === "https://app.example.com")).toHaveLength(1);
  });
});
