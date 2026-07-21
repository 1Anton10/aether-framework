use aether_compiler::codegen::WasmGenerator;
use aether_compiler::parsers::parse_file;
use aether_ir::AppBindings;
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;

fn main() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        return Err(
            "Usage:\n  aether-compile --file <entry> <PROJECT_ROOT> [out_dir] [bindings.json]\n  aether-compile '<JSX>' <PROJECT_ROOT> [out_dir] [bindings.json]"
                .into(),
        );
    }

    let (source_code, entry_path, project_root, out_dir, bindings_path) = if args[1] == "--file" {
        if args.len() < 4 {
            return Err(
                "Usage: aether-compile --file <entry> <PROJECT_ROOT> [out_dir] [bindings.json]"
                    .into(),
            );
        }
        let path = PathBuf::from(&args[2]);
        let source = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let root = args[3].clone();
        let out = if args.len() >= 5 {
            PathBuf::from(&args[4])
        } else {
            PathBuf::from(&root)
        };
        let bindings = if args.len() >= 6 {
            Some(args[5].clone())
        } else {
            None
        };
        (source, Some(path), root, out, bindings)
    } else {
        let source = args[1].clone();
        let root = args[2].clone();
        let out = if args.len() >= 4 {
            PathBuf::from(&args[3])
        } else {
            PathBuf::from(&root)
        };
        let bindings = if args.len() >= 5 {
            Some(args[4].clone())
        } else {
            None
        };
        (source, None, root, out, bindings)
    };

    let bindings: AppBindings = if let Some(path) = bindings_path {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())?
    } else if let Ok(path) = env::var("AETHER_BINDINGS") {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        AppBindings::default()
    };

    env::set_var("AETHER_PROJECT_ROOT", &project_root);
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let program = if let Some(ref path) = entry_path {
        parse_file(path, &source_code, &bindings)?
    } else {
        aether_compiler::parse_jsx_with_bindings(&source_code, &bindings)?
    };

    let use_gc = env::var("AETHER_WASMGC").ok().as_deref() == Some("1");
    let mut generator = WasmGenerator::new();
    // Always emit portable linear Wasm; optionally also real WasmGC module.
    let linear_bytes = generator.generate(&program);
    fs::write(out_dir.join("app.wasm"), &linear_bytes).map_err(|e| e.to_string())?;
    if use_gc {
        let mut gc_gen = WasmGenerator::new();
        let gc_bytes = gc_gen.generate_with_gc(&program);
        fs::write(out_dir.join("app.gc.wasm"), &gc_bytes).map_err(|e| e.to_string())?;
    }

    let mut program_val = serde_json::to_value(&program).map_err(|e| e.to_string())?;
    if let serde_json::Value::Object(ref mut map) = program_val {
        map.insert(
            "memory_model".into(),
            serde_json::Value::String(if use_gc {
                "wasmgc+linear".into()
            } else {
                "linear".into()
            }),
        );
        map.insert(
            "frontends".into(),
            serde_json::json!([
                "jsx", "tsx", "vue", "svelte", "html", "angular", "solid", "qwik", "lit", "preact"
            ]),
        );
        map.insert("wasm_gc".into(), serde_json::Value::Bool(use_gc));
    }
    let program_json = serde_json::to_string(&program_val).map_err(|e| e.to_string())?;
    fs::write(out_dir.join("aether.program.json"), &program_json).map_err(|e| e.to_string())?;

    let mut stdout = io::stdout();
    stdout
        .write_all(program_json.as_bytes())
        .map_err(|e| e.to_string())?;
    stdout.flush().map_err(|e| e.to_string())?;
    Ok(())
}
