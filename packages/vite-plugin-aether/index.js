import fs from "node:fs";
import path from "node:path";

const VIRTUAL_PROGRAM = "\0aether:program";
const PUBLIC_PROGRAM = "aether:program";

const LOG =
  "[aether] UI compiles via aether-compile (Wasm IR → aether.program.json)";

function findAetherRoot(start) {
  let current = path.resolve(start);
  const root = path.parse(current).root;
  while (current !== root) {
    if (fs.existsSync(path.join(current, "aether.config.json"))) return current;
    current = path.dirname(current);
  }
  return path.resolve(start);
}

function loadAetherConfig(root) {
  const configPath = path.join(root, "aether.config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Vite plugin for Aether projects.
 *
 * - Logs compile pipeline on dev/build start
 * - Virtual module `aether:program` → `dist/aether.program.json`
 * - Injects `<!-- aether -->` and `<script type="aether/hint">` into HTML
 * - Resolves project root from `aether.config.json`
 */
export function aether(options = {}) {
  let projectRoot = process.cwd();
  let programOutDir = path.join(projectRoot, "dist");

  return {
    name: "vite-plugin-aether",
    enforce: "pre",

    configResolved(config) {
      const aetherRoot = findAetherRoot(options.root ?? config.root);
      const aetherConfig = loadAetherConfig(aetherRoot);
      projectRoot = path.resolve(aetherRoot, aetherConfig.root || ".");
      const outDir =
        options.outDir ?? aetherConfig.outDir ?? config.build?.outDir ?? "dist";
      programOutDir = path.isAbsolute(outDir)
        ? outDir
        : path.resolve(projectRoot, outDir);
    },

    buildStart() {
      console.log(LOG);
    },

    configureServer() {
      console.log(LOG);
    },

    resolveId(id) {
      if (id === PUBLIC_PROGRAM) return VIRTUAL_PROGRAM;
    },

    load(id) {
      if (id !== VIRTUAL_PROGRAM) return null;
      const programPath = path.join(programOutDir, "aether.program.json");
      if (!fs.existsSync(programPath)) {
        return "export default null;";
      }
      const json = fs.readFileSync(programPath, "utf-8");
      return `export default ${json};`;
    },

    transformIndexHtml(html) {
      let out = html;
      if (!out.includes("<!-- aether -->")) {
        if (out.includes("<head>")) {
          out = out.replace("<head>", "<head>\n  <!-- aether -->");
        } else {
          out = `<!-- aether -->\n${out}`;
        }
      }
      const hint =
        '<script type="aether/hint">{"runtime":"wasm","program":"aether:program"}</script>';
      if (!out.includes('type="aether/hint"')) {
        if (out.includes("</head>")) {
          out = out.replace("</head>", `  ${hint}\n</head>`);
        } else {
          out = `${hint}\n${out}`;
        }
      }
      return out;
    },
  };
}

export default aether;
