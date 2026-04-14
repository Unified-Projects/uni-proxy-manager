import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { compileMaintenancePage } from "./maintenance-page-compiler";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("compileMaintenancePage", () => {
  it("generates a HAProxy error file with inlined local CSS, JS, and images", async () => {
    const pageDir = await mkdtemp(join(tmpdir(), "maintenance-page-"));
    tempDirs.push(pageDir);

    await writeFile(
      join(pageDir, "index.html"),
      `<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    <img src="./images/logo.png" alt="Logo">
    <script src="./app.js"></script>
  </body>
</html>`,
      "utf-8",
    );
    await writeFile(
      join(pageDir, "style.css"),
      'body { background-image: url("./images/bg.png"); color: #fff; }',
      "utf-8",
    );
    await writeFile(
      join(pageDir, "app.js"),
      "window.__maintenanceReady = true;",
      "utf-8",
    );

    const pngPixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAwMBASD7nSUAAAAASUVORK5CYII=",
      "base64",
    );
    await mkdir(join(pageDir, "images"), { recursive: true });
    await writeFile(join(pageDir, "images/logo.png"), pngPixel);
    await writeFile(join(pageDir, "images/bg.png"), pngPixel);

    const compiledPath = await compileMaintenancePage(pageDir, "index.html");
    const compiled = await readFile(compiledPath, "utf-8");

    expect(compiled).toContain("HTTP/1.0 503 Service Unavailable");
    expect(compiled).toContain("Content-Type: text/html; charset=utf-8");
    expect(compiled).toContain(
      '<style>body { background-image: url("data:image/png;base64,',
    );
    expect(compiled).toContain('<img src="data:image/png;base64,');
    expect(compiled).toContain("window.__maintenanceReady = true;");
    expect(compiled).not.toContain("style.css");
    expect(compiled).not.toContain("./images/logo.png");
    expect(compiled).not.toContain("./app.js");
  });
});
