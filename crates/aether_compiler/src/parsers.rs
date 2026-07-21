//! Frontends → shared Aether IR.
//! JSX/TSX, Vue SFC, Svelte, HTML, Angular templates, Solid, Qwik, Lit → jsxish → SWC lower.
use aether_ir::{AetherProgram, AppBindings};
use std::path::Path;

use crate::parse_jsx_with_bindings;

/// Detect source kind from path extension / content.
pub fn parse_file(path: &Path, source: &str, bindings: &AppBindings) -> Result<AetherProgram, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "tsx" | "jsx" | "ts" | "js" | "mjs" => {
            if source.contains("solid-js") || source.contains("createSignal") {
                parse_solid(source, bindings)
            } else if source.contains("@builder.io/qwik") || source.contains("component$") {
                parse_qwik(source, bindings)
            } else if source.contains("lit") && (source.contains("html`") || source.contains("@customElement")) {
                parse_lit(source, bindings)
            } else {
                parse_jsx_with_bindings(source, bindings)
            }
        }
        "vue" => parse_vue_sfc(source, bindings),
        "svelte" => parse_svelte(source, bindings),
        "html" | "htm" => {
            if name.ends_with(".component.html")
                || source.contains("(click)")
                || source.contains("*ngIf")
                || source.contains("[ngModel]")
            {
                parse_angular_template(source, bindings)
            } else {
                parse_html_template(source, bindings)
            }
        }
        _ => detect_and_parse(source, bindings),
    }
}

fn detect_and_parse(source: &str, bindings: &AppBindings) -> Result<AetherProgram, String> {
    if source.contains("<template") {
        parse_vue_sfc(source, bindings)
    } else if source.contains("{#") || (source.contains("<script") && source.contains("on:click")) {
        parse_svelte(source, bindings)
    } else if source.contains("(click)") || source.contains("*ngFor") {
        parse_angular_template(source, bindings)
    } else if source.contains("html`") {
        parse_lit(source, bindings)
    } else {
        parse_jsx_with_bindings(source, bindings)
    }
}

/// Vue SFC: use `<template>` body. Supports `{{ x }}`, `@click="handler"`, `:attr="x"`.
pub fn parse_vue_sfc(source: &str, bindings: &AppBindings) -> Result<AetherProgram, String> {
    let template = extract_tag_inner(source, "template")
        .ok_or_else(|| "Vue SFC: <template> not found".to_string())?;
    let jsxish = vue_template_to_jsxish(&template);
    parse_jsx_with_bindings(&wrap_default_export(&jsxish), bindings)
}

/// Svelte-like: `{count}`, `on:click={handler}`, plain tags.
pub fn parse_svelte(source: &str, bindings: &AppBindings) -> Result<AetherProgram, String> {
    let markup = strip_svelte_script(source);
    let jsxish = svelte_to_jsxish(&markup);
    parse_jsx_with_bindings(&wrap_default_export(&jsxish), bindings)
}

/// HTML with `{{x}}` / `{x}` interpolations and `on:click` / `@click` / `onclick={h}`.
pub fn parse_html_template(source: &str, bindings: &AppBindings) -> Result<AetherProgram, String> {
    let body = extract_tag_inner(source, "body").unwrap_or_else(|| source.to_string());
    let jsxish = html_to_jsxish(&body);
    parse_jsx_with_bindings(&wrap_default_export(&jsxish), bindings)
}

/// Angular component template: `{{x}}`, `(click)="h()"`, `[attr]="x"`, `*ngIf` stripped to content.
pub fn parse_angular_template(source: &str, bindings: &AppBindings) -> Result<AetherProgram, String> {
    let body = extract_tag_inner(source, "body").unwrap_or_else(|| source.to_string());
    let jsxish = angular_to_jsxish(&body);
    parse_jsx_with_bindings(&wrap_default_export(&jsxish), bindings)
}

/// Solid JSX: `{count()}` → `{count}`, `onClick={...}` already fine.
pub fn parse_solid(source: &str, bindings: &AppBindings) -> Result<AetherProgram, String> {
    let jsxish = solid_to_jsxish(source);
    parse_jsx_with_bindings(&jsxish, bindings)
}

/// Qwik JSX: strip `component$` wrappers to export default JSX tree when possible.
pub fn parse_qwik(source: &str, bindings: &AppBindings) -> Result<AetherProgram, String> {
    let jsxish = qwik_to_jsxish(source);
    parse_jsx_with_bindings(&jsxish, bindings)
}

/// Lit `html\`...\`` → jsxish.
pub fn parse_lit(source: &str, bindings: &AppBindings) -> Result<AetherProgram, String> {
    let tpl = extract_lit_html(source).ok_or_else(|| "Lit: html`...` template not found".to_string())?;
    let jsxish = lit_to_jsxish(&tpl);
    parse_jsx_with_bindings(&wrap_default_export(&jsxish), bindings)
}

fn wrap_default_export(jsx: &str) -> String {
    format!("export default function App() {{\n  return (\n{}\n  );\n}}\n", jsx)
}

fn extract_tag_inner(source: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = source.find(&open)?;
    let after = source[start..].find('>')? + start + 1;
    let end = source[after..].find(&close)? + after;
    Some(source[after..end].trim().to_string())
}

fn strip_svelte_script(source: &str) -> String {
    let mut out = source.to_string();
    while let Some(s) = out.find("<script") {
        if let Some(e) = out[s..].find("</script>") {
            let end = s + e + "</script>".len();
            out.replace_range(s..end, "");
        } else {
            break;
        }
    }
    out.trim().to_string()
}

fn vue_template_to_jsxish(t: &str) -> String {
    let mut s = t.to_string();
    while let Some(a) = s.find("{{") {
        if let Some(b) = s[a..].find("}}") {
            let inner = s[a + 2..a + b].trim().to_string();
            s.replace_range(a..a + b + 2, &format!("{{{}}}", inner));
        } else {
            break;
        }
    }
    s = replace_attr_quotes(&s, "@click", "onClick");
    s = replace_attr_quotes(&s, "@submit", "onSubmit");
    s = replace_bound_attrs(&s);
    s = s.replace(" class=", " className=");
    s
}

fn svelte_to_jsxish(t: &str) -> String {
    let mut s = t.to_string();
    s = s.replace("on:click=", "onClick=");
    s = s.replace("on:submit=", "onSubmit=");
    s = s.replace(" class=", " className=");
    s
}

fn html_to_jsxish(t: &str) -> String {
    let mut s = vue_template_to_jsxish(t);
    s = s.replace("onclick=", "onClick=");
    s = s.replace(" class=", " className=");
    s
}

fn angular_to_jsxish(t: &str) -> String {
    let mut s = t.to_string();
    // {{ expr }} → {expr}
    while let Some(a) = s.find("{{") {
        if let Some(b) = s[a..].find("}}") {
            let inner = s[a + 2..a + b].trim().to_string();
            s.replace_range(a..a + b + 2, &format!("{{{}}}", inner));
        } else {
            break;
        }
    }
    // (click)="inc_count()" → onClick={inc_count}
    s = replace_angular_event(&s, "click", "onClick");
    s = replace_angular_event(&s, "submit", "onSubmit");
    // [title]="x" → title={x}
    s = replace_angular_prop(&s);
    // strip *ngIf / *ngFor structural attrs (keep children)
    s = strip_attr_prefix(&s, "*ngIf");
    s = strip_attr_prefix(&s, "*ngFor");
    s = s.replace(" class=", " className=");
    s
}

fn solid_to_jsxish(source: &str) -> String {
    // Only rewrite exact `{ident()}` Solid signal reads (do not pair arbitrary braces).
    let bytes = source.as_bytes();
    let mut out = String::with_capacity(source.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            let after = i + 1;
            let mut j = after;
            while j < bytes.len()
                && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'$')
            {
                j += 1;
            }
            if j > after
                && j + 2 < bytes.len()
                && bytes[j] == b'('
                && bytes[j + 1] == b')'
                && bytes[j + 2] == b'}'
            {
                out.push('{');
                out.push_str(std::str::from_utf8(&bytes[after..j]).unwrap());
                out.push('}');
                i = j + 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn qwik_to_jsxish(source: &str) -> String {
    let s = solid_to_jsxish(source);
    // component$(() => { return ( <jsx/> ); }) → export default function App() { return ( <jsx/> ); }
    if let Some(jsx) = extract_return_jsx(&s) {
        return wrap_default_export(&jsx);
    }
    s
}

/// Pull the JSX element from a `return ( <...> )` / `return <...>` body if present.
fn extract_return_jsx(source: &str) -> Option<String> {
    let key = "return";
    let mut search = source;
    while let Some(i) = search.find(key) {
        let after = &search[i + key.len()..];
        let trimmed = after.trim_start();
        if trimmed.starts_with('(') {
            let body = trimmed[1..].trim_start();
            if let Some(end) = find_matching_paren(trimmed) {
                // trimmed is "( ... )" — extract inside
                let inner = trimmed[1..end].trim();
                if inner.starts_with('<') {
                    return Some(inner.to_string());
                }
            }
            // fallback: from first < to last >
            if let (Some(a), Some(b)) = (body.find('<'), body.rfind('>')) {
                return Some(body[a..=b].to_string());
            }
        } else if trimmed.starts_with('<') {
            if let Some(b) = trimmed.rfind('>') {
                return Some(trimmed[..=b].to_string());
            }
        }
        search = &search[i + key.len()..];
    }
    None
}

fn find_matching_paren(s: &str) -> Option<usize> {
    if !s.starts_with('(') {
        return None;
    }
    let mut depth = 0i32;
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_lit_html(source: &str) -> Option<String> {
    let start = source.find("html`")?;
    let after = start + "html`".len();
    let end = source[after..].find('`')? + after;
    Some(source[after..end].to_string())
}

fn lit_to_jsxish(t: &str) -> String {
    let mut s = t.to_string();
    // ${count} → {count}
    while let Some(a) = s.find("${") {
        if let Some(b) = s[a..].find('}') {
            let inner = s[a + 2..a + b].trim().to_string();
            s.replace_range(a..a + b + 1, &format!("{{{}}}", inner));
        } else {
            break;
        }
    }
    // @click=${h} → onClick={h}
    s = s.replace("@click=", "onClick=");
    s = s.replace("@submit=", "onSubmit=");
    s = s.replace(" class=", " className=");
    s
}

fn replace_angular_event(s: &str, ev: &str, jsx: &str) -> String {
    // (click)="name()" or (click)="name"
    let pattern = format!("({})=\"", ev);
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find(&pattern) {
        out.push_str(&rest[..i]);
        out.push_str(jsx);
        out.push_str("={");
        let after = i + pattern.len();
        if let Some(end) = rest[after..].find('"') {
            let mut name = rest[after..after + end].trim().to_string();
            if name.ends_with("()") {
                name.truncate(name.len() - 2);
            }
            out.push_str(&name);
            out.push('}');
            rest = &rest[after + end + 1..];
        } else {
            out.push_str(&rest[i..]);
            return out;
        }
    }
    out.push_str(rest);
    out
}

fn replace_angular_prop(s: &str) -> String {
    // [foo]="bar" → foo={bar}
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('[') {
        let prev_ok = i == 0 || rest.as_bytes()[i - 1].is_ascii_whitespace();
        if !prev_ok {
            out.push_str(&rest[..=i]);
            rest = &rest[i + 1..];
            continue;
        }
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        if let Some(close) = after.find("]=\"") {
            let name = after[..close].trim();
            let val_start = close + 3;
            if let Some(end) = after[val_start..].find('"') {
                let val = after[val_start..val_start + end].trim();
                out.push_str(name);
                out.push_str("={");
                out.push_str(val);
                out.push('}');
                rest = &after[val_start + end + 1..];
                continue;
            }
        }
        out.push('[');
        rest = after;
    }
    out.push_str(rest);
    out
}

fn strip_attr_prefix(s: &str, attr: &str) -> String {
    // *ngIf="..." → remove attribute
    let pattern = format!("{}=\"", attr);
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find(&pattern) {
        out.push_str(&rest[..i]);
        let after = i + pattern.len();
        if let Some(end) = rest[after..].find('"') {
            rest = &rest[after + end + 1..];
        } else {
            out.push_str(&rest[i..]);
            return out;
        }
    }
    out.push_str(rest);
    out
}

fn replace_attr_quotes(s: &str, from: &str, to: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    let pattern = format!("{}=\"", from);
    while let Some(i) = rest.find(&pattern) {
        out.push_str(&rest[..i]);
        out.push_str(to);
        out.push_str("={");
        let after = i + pattern.len();
        if let Some(end) = rest[after..].find('"') {
            let name = rest[after..after + end].trim();
            out.push_str(name);
            out.push('}');
            rest = &rest[after + end + 1..];
        } else {
            out.push_str(&rest[i..]);
            return out;
        }
    }
    out.push_str(rest);
    out
}

fn replace_bound_attrs(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find(':') {
        let prev_ok = i == 0 || rest.as_bytes()[i - 1].is_ascii_whitespace();
        if !prev_ok {
            out.push_str(&rest[..=i]);
            rest = &rest[i + 1..];
            continue;
        }
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        if let Some(eq) = after.find("=\"") {
            let name = after[..eq].trim();
            let val_start = eq + 2;
            if let Some(end) = after[val_start..].find('"') {
                let val = after[val_start..val_start + end].trim();
                out.push_str(name);
                out.push_str("={");
                out.push_str(val);
                out.push('}');
                rest = &after[val_start + end + 1..];
                continue;
            }
        }
        out.push(':');
        rest = after;
    }
    out.push_str(rest);
    out
}

/// Golden rule helper: all frontends must lower to structurally equal programs on fixtures.
pub fn programs_equivalent(a: &AetherProgram, b: &AetherProgram) -> bool {
    a.slots.len() == b.slots.len()
        && a.edges.len() == b.edges.len()
        && a.nodes.len() == b.nodes.len()
        && a.slots
            .iter()
            .zip(b.slots.iter())
            .all(|(x, y)| x.name == y.name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aether_ir::AppBindings;

    #[test]
    fn vue_and_jsx_same_slots() {
        let bindings = AppBindings::default();
        let vue = r#"
<template>
  <div>
    <h1>{{ count }}</h1>
    <button @click="inc_count">+</button>
  </div>
</template>
"#;
        let jsx = r#"
export default function App() {
  return (
    <div>
      <h1>{count}</h1>
      <button onClick={inc_count}>+</button>
    </div>
  );
}
"#;
        let a = parse_vue_sfc(vue, &bindings).expect("vue");
        let b = parse_jsx_with_bindings(jsx, &bindings).expect("jsx");
        assert!(
            programs_equivalent(&a, &b),
            "vue slots {:?} jsx {:?}",
            a.slots.iter().map(|s| &s.name).collect::<Vec<_>>(),
            b.slots.iter().map(|s| &s.name).collect::<Vec<_>>()
        );
    }

    #[test]
    fn angular_and_jsx_same_slots() {
        let bindings = AppBindings::default();
        let ng = r#"
<div>
  <h1>{{ count }}</h1>
  <button (click)="inc_count()">+</button>
</div>
"#;
        let jsx = r#"
export default function App() {
  return (
    <div>
      <h1>{count}</h1>
      <button onClick={inc_count}>+</button>
    </div>
  );
}
"#;
        let a = parse_angular_template(ng, &bindings).expect("angular");
        let b = parse_jsx_with_bindings(jsx, &bindings).expect("jsx");
        assert!(programs_equivalent(&a, &b));
    }

    #[test]
    fn solid_signal_reads_normalize() {
        let bindings = AppBindings::default();
        let solid = r#"
export default function App() {
  return (
    <div>
      <h1>{count()}</h1>
      <button onClick={inc_count}>+</button>
    </div>
  );
}
"#;
        let jsx = r#"
export default function App() {
  return (
    <div>
      <h1>{count}</h1>
      <button onClick={inc_count}>+</button>
    </div>
  );
}
"#;
        let normalized = solid_to_jsxish(solid);
        assert!(
            normalized.contains("{count}"),
            "expected {{count}} in {:?}",
            normalized
        );
        assert!(
            !normalized.contains("{count()}"),
            "signal call not stripped: {:?}",
            normalized
        );
        let a = parse_solid(solid, &bindings).expect("solid");
        let b = parse_jsx_with_bindings(jsx, &bindings).expect("jsx");
        assert!(
            programs_equivalent(&a, &b),
            "solid slots {:?} edges {} nodes {} | jsx slots {:?} edges {} nodes {}",
            a.slots.iter().map(|s| &s.name).collect::<Vec<_>>(),
            a.edges.len(),
            a.nodes.len(),
            b.slots.iter().map(|s| &s.name).collect::<Vec<_>>(),
            b.edges.len(),
            b.nodes.len()
        );
    }
}
