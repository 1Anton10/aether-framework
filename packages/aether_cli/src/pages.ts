import * as fs from "fs";
import * as path from "path";

const PAGE_EXT = /\.(tsx|jsx|vue|svelte|html)$/i;
const LOADER_FILE = /(?:^|\/)(?:\+loader|page\.loader|[^/]+\.loader)\.ts$/;

export type PageRoute = {
  route: string;
  file: string;
};

export type PageManifestEntry = {
  route: string;
  file: string;
  loader: string | null;
};

function segmentToParam(segment: string): string {
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return `:${segment.slice(1, -1)}`;
  }
  return segment;
}

function fileToRoute(relFromPages: string): string {
  const withoutExt = relFromPages.replace(PAGE_EXT, "");
  const parts = withoutExt.split(/[/\\]/).filter(Boolean);
  if (parts.length > 0 && parts[parts.length - 1] === "index") {
    parts.pop();
  }
  if (parts.length === 0) return "/";
  return `/${parts.map(segmentToParam).join("/")}`;
}

function collectPageFiles(dir: string, baseDir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectPageFiles(full, baseDir, out);
    } else if (
      ent.isFile() &&
      PAGE_EXT.test(ent.name) &&
      !LOADER_FILE.test(path.relative(baseDir, full).replace(/\\/g, "/"))
    ) {
      out.push(full);
    }
  }
}

/**
 * Discover file-based routes under `src/pages`.
 *
 * - `src/pages/index.tsx` → `/`
 * - `src/pages/about.tsx` → `/about`
 * - `src/pages/about/index.tsx` → `/about`
 * - `src/pages/users/[id].tsx` → `/users/:id`
 */
export function discoverPages(root: string): PageRoute[] {
  const pagesDir = path.join(root, "src", "pages");
  const files: string[] = [];
  collectPageFiles(pagesDir, pagesDir, files);

  const routes = files.map((file) => {
    const rel = path.relative(pagesDir, file);
    return {
      route: fileToRoute(rel),
      file: path.resolve(file),
    };
  });

  routes.sort((a, b) => a.route.localeCompare(b.route));
  return routes;
}

/**
 * Locate a data loader module for a page file.
 *
 * Checks, in order: `page.loader.ts`, `+loader.ts`, `{stem}.loader.ts`,
 * and for `index` pages `{parentDir}.loader.ts` (e.g. `about.loader.ts`).
 */
export function discoverLoaders(pageFile: string): string | null {
  const dir = path.dirname(pageFile);
  const ext = path.extname(pageFile);
  const stem = path.basename(pageFile, ext);
  const parentName = path.basename(dir);

  const candidates = [
    path.join(dir, "page.loader.ts"),
    path.join(dir, "+loader.ts"),
    path.join(dir, `${stem}.loader.ts`),
  ];

  if (stem === "index" && parentName !== "pages") {
    candidates.push(path.join(dir, `${parentName}.loader.ts`));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Build a pages manifest with relative paths from project root. */
export function buildPagesManifest(root: string): PageManifestEntry[] {
  const resolvedRoot = path.resolve(root);
  return discoverPages(resolvedRoot).map(({ route, file }) => {
    const loader = discoverLoaders(file);
    return {
      route,
      file: path.relative(resolvedRoot, file).replace(/\\/g, "/"),
      loader: loader
        ? path.relative(resolvedRoot, loader).replace(/\\/g, "/")
        : null,
    };
  });
}
