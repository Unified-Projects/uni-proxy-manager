import { readFile, writeFile } from "fs/promises";
import { dirname, extname, join, resolve, relative } from "path";

export const MAINTENANCE_ERRORFILE_NAME = "maintenance.http";

const MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isPathWithinRoot(rootDir: string, targetPath: string): boolean {
  const relPath = relative(resolve(rootDir), resolve(targetPath));
  return relPath === "" || (!relPath.startsWith("..") && relPath !== "..");
}

function isExternalReference(reference: string): boolean {
  const trimmed = reference.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  );
}

function stripSearchAndHash(reference: string): string {
  const hashIndex = reference.indexOf("#");
  const queryIndex = reference.indexOf("?");
  const cutIndex = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return cutIndex === undefined ? reference : reference.slice(0, cutIndex);
}

function getMimeType(filePath: string): string {
  return (
    MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream"
  );
}

function escapeInlineScript(script: string): string {
  return script.replace(/<\/script/gi, "<\\/script");
}

function resolveLocalAssetPath(
  reference: string,
  currentDir: string,
  rootDir: string,
): string | null {
  if (isExternalReference(reference)) {
    return null;
  }

  const withoutSearch = stripSearchAndHash(reference).trim();
  if (!withoutSearch) {
    return null;
  }

  const decodedPath = decodeURIComponent(withoutSearch);
  const absolutePath = decodedPath.startsWith("/")
    ? resolve(rootDir, `.${decodedPath}`)
    : resolve(currentDir, decodedPath);

  if (!isPathWithinRoot(rootDir, absolutePath)) {
    throw new Error(
      `Asset path escapes maintenance page directory: ${reference}`,
    );
  }

  return absolutePath;
}

async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (...args: RegExpExecArray) => Promise<string>,
): Promise<string> {
  const matches = Array.from(input.matchAll(pattern));
  if (matches.length === 0) {
    return input;
  }

  const replacements = await Promise.all(
    matches.map(async (match) => ({
      index: match.index ?? 0,
      length: match[0].length,
      value: await replacer(match as RegExpExecArray),
    })),
  );

  let output = "";
  let cursor = 0;

  for (const replacement of replacements) {
    output += input.slice(cursor, replacement.index);
    output += replacement.value;
    cursor = replacement.index + replacement.length;
  }

  output += input.slice(cursor);
  return output;
}

interface InlineState {
  assetCache: Map<string, string>;
  cssCache: Map<string, string>;
}

async function assetToDataUri(
  assetPath: string,
  state: InlineState,
): Promise<string> {
  const cached = state.assetCache.get(assetPath);
  if (cached) {
    return cached;
  }

  const asset = await readFile(assetPath);
  const dataUri = `data:${getMimeType(assetPath)};base64,${asset.toString("base64")}`;
  state.assetCache.set(assetPath, dataUri);
  return dataUri;
}

async function inlineCss(
  cssContent: string,
  currentDir: string,
  rootDir: string,
  state: InlineState,
): Promise<string> {
  let output = cssContent;

  output = await replaceAsync(
    output,
    /@import\s+(?:url\((['"]?)([^)"']+)\1\)|(['"])([^"']+)\3)\s*;/gi,
    async (match) => {
      const reference = match[2] || match[4];
      const resolved = resolveLocalAssetPath(reference, currentDir, rootDir);
      if (!resolved) {
        return match[0];
      }

      const importedCss = await inlineCssFile(resolved, rootDir, state);
      return importedCss;
    },
  );

  output = await replaceAsync(
    output,
    /url\((['"]?)([^)"']+)\1\)/gi,
    async (match) => {
      const reference = match[2].trim();
      const resolved = resolveLocalAssetPath(reference, currentDir, rootDir);
      if (!resolved) {
        return match[0];
      }

      const dataUri = await assetToDataUri(resolved, state);
      return `url("${dataUri}")`;
    },
  );

  return output;
}

async function inlineCssFile(
  cssPath: string,
  rootDir: string,
  state: InlineState,
): Promise<string> {
  const cached = state.cssCache.get(cssPath);
  if (cached) {
    return cached;
  }

  const css = await readFile(cssPath, "utf-8");
  const inlined = await inlineCss(css, dirname(cssPath), rootDir, state);
  state.cssCache.set(cssPath, inlined);
  return inlined;
}

function inlineSrcsetValue(
  srcset: string,
  replaceReference: (reference: string) => Promise<string | null>,
): Promise<string> {
  const candidates = srcset.split(",");

  return Promise.all(
    candidates.map(async (candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) {
        return candidate;
      }

      const parts = trimmed.split(/\s+/);
      const reference = parts[0];
      const descriptor = parts.slice(1).join(" ");
      const replacement = await replaceReference(reference);
      if (!replacement) {
        return candidate;
      }

      return descriptor ? `${replacement} ${descriptor}` : replacement;
    }),
  ).then((resolved) => resolved.join(", "));
}

async function inlineHtml(
  htmlContent: string,
  entryDir: string,
  rootDir: string,
  state: InlineState,
): Promise<string> {
  let output = htmlContent;

  const replaceReference = async (
    reference: string,
  ): Promise<string | null> => {
    const resolved = resolveLocalAssetPath(reference, entryDir, rootDir);
    if (!resolved) {
      return null;
    }
    return assetToDataUri(resolved, state);
  };

  output = await replaceAsync(
    output,
    /<link\b([^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*)\bhref\s*=\s*(["'])([^"']+)\2([^>]*)>/gi,
    async (match) => {
      const reference = match[3];
      const resolved = resolveLocalAssetPath(reference, entryDir, rootDir);
      if (!resolved) {
        return match[0];
      }

      const css = await inlineCssFile(resolved, rootDir, state);
      return `<style>${css}</style>`;
    },
  );

  output = await replaceAsync(
    output,
    /<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    async (match) => {
      const reference = match[3];
      const resolved = resolveLocalAssetPath(reference, entryDir, rootDir);
      if (!resolved) {
        return match[0];
      }

      const script = await readFile(resolved, "utf-8");
      return `<script>${escapeInlineScript(script)}</script>`;
    },
  );

  output = await replaceAsync(
    output,
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    async (match) => {
      const css = await inlineCss(match[2], entryDir, rootDir, state);
      return `<style${match[1]}>${css}</style>`;
    },
  );

  output = await replaceAsync(
    output,
    /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi,
    async (match) => {
      const css = await inlineCss(match[2], entryDir, rootDir, state);
      return `style=${match[1]}${css}${match[1]}`;
    },
  );

  output = await replaceAsync(
    output,
    /\bsrcset\s*=\s*(["'])([\s\S]*?)\1/gi,
    async (match) => {
      const srcset = await inlineSrcsetValue(match[2], replaceReference);
      return `srcset=${match[1]}${srcset}${match[1]}`;
    },
  );

  output = await replaceAsync(
    output,
    /\b(src|poster|data)\s*=\s*(["'])([^"']+)\2/gi,
    async (match) => {
      const replacement = await replaceReference(match[3]);
      if (!replacement) {
        return match[0];
      }

      return `${match[1]}=${match[2]}${replacement}${match[2]}`;
    },
  );

  return output;
}

function buildMaintenanceErrorResponse(html: string): string {
  const headers = [
    "HTTP/1.0 503 Service Unavailable",
    "Cache-Control: no-cache",
    "Connection: close",
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
  ];

  return headers.join("\r\n");
}

export async function compileMaintenancePage(
  directoryPath: string,
  entryFile: string,
): Promise<string> {
  const rootDir = resolve(directoryPath);
  const entryPath = resolve(rootDir, entryFile);

  if (!isPathWithinRoot(rootDir, entryPath)) {
    throw new Error(
      "Maintenance entry file must stay within the page directory",
    );
  }

  const html = await readFile(entryPath, "utf-8");
  const state: InlineState = {
    assetCache: new Map(),
    cssCache: new Map(),
  };

  const inlinedHtml = await inlineHtml(
    html,
    dirname(entryPath),
    rootDir,
    state,
  );
  const compiledPath = join(rootDir, MAINTENANCE_ERRORFILE_NAME);
  await writeFile(
    compiledPath,
    buildMaintenanceErrorResponse(inlinedHtml),
    "utf-8",
  );

  return compiledPath;
}
