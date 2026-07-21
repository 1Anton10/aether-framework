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
    let mut s = rewrite_v_for(t);
    s = rewrite_v_if(&s);
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
    let mut s = rewrite_svelte_each(t);
    s = rewrite_svelte_if(&s);
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
    let mut s = rewrite_ng_for(t);
    s = rewrite_ng_if(&s);
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
    // strip leftover *ngIf (lists already rewritten)
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

/// `v-for="item in items"` → `{items.map((item) => ( <el/> ))}`
fn rewrite_v_for(s: &str) -> String {
    rewrite_attr_loop(s, "v-for", parse_in_of_binding)
}

/// `v-if="visible"` → `{visible && ( <el/> )}`
fn rewrite_v_if(s: &str) -> String {
    rewrite_attr_condition(s, "v-if")
}

/// `*ngFor="let item of items"` → `{items.map((item) => ( <el/> ))}`
fn rewrite_ng_for(s: &str) -> String {
    rewrite_attr_loop(s, "*ngFor", parse_ng_for_binding)
}

/// `*ngIf="visible"` → `{visible && ( <el/> )}`
fn rewrite_ng_if(s: &str) -> String {
    rewrite_attr_condition(s, "*ngIf")
}

fn parse_in_of_binding(val: &str) -> Option<(String, String)> {
    let val = val.trim();
    // item in items | (item, i) in items | item of items
    for sep in [" in ", " of "] {
        if let Some((left, right)) = val.split_once(sep) {
            let item = left
                .trim()
                .trim_start_matches('(')
                .split(',')
                .next()?
                .trim()
                .to_string();
            let coll = right.trim().to_string();
            if !item.is_empty() && !coll.is_empty() {
                return Some((item, coll));
            }
        }
    }
    None
}

fn parse_ng_for_binding(val: &str) -> Option<(String, String)> {
    let val = val.trim();
    let rest = val.strip_prefix("let ")?.trim();
    let (item, coll) = rest.split_once(" of ").or_else(|| rest.split_once(" in "))?;
    let item = item.trim().to_string();
    let coll = coll.trim().to_string();
    if item.is_empty() || coll.is_empty() {
        return None;
    }
    Some((item, coll))
}

fn rewrite_attr_loop(
    s: &str,
    attr: &str,
    parse_binding: fn(&str) -> Option<(String, String)>,
) -> String {
    let pattern = format!("{}=\"", attr);
    let mut out = String::new();
    let mut rest = s;
    while let Some(attr_i) = rest.find(&pattern) {
        let val_start = attr_i + pattern.len();
        let Some(val_end) = rest[val_start..].find('"') else {
            out.push_str(rest);
            return out;
        };
        let val = &rest[val_start..val_start + val_end];
        let Some((item, coll)) = parse_binding(val) else {
            // skip this attr occurrence
            out.push_str(&rest[..val_start + val_end + 1]);
            rest = &rest[val_start + val_end + 1..];
            continue;
        };
        let Some(tag_start) = rest[..attr_i].rfind('<') else {
            out.push_str(&rest[..val_start + val_end + 1]);
            rest = &rest[val_start + val_end + 1..];
            continue;
        };
        let Some(elem_len) = element_span_len(&rest[tag_start..]) else {
            out.push_str(&rest[..val_start + val_end + 1]);
            rest = &rest[val_start + val_end + 1..];
            continue;
        };
        let elem_end = tag_start + elem_len;
        let mut elem = rest[tag_start..elem_end].to_string();
        elem = strip_attr_prefix(&elem, attr);
        out.push_str(&rest[..tag_start]);
        out.push('{');
        out.push_str(&coll);
        out.push_str(".map((");
        out.push_str(&item);
        out.push_str(") => (\n");
        out.push_str(elem.trim());
        out.push_str("\n))}");
        rest = &rest[elem_end..];
    }
    out.push_str(rest);
    out
}

/// `v-if="visible"` / `*ngIf="visible"` → `{visible && ( <el/> )}`
fn rewrite_attr_condition(s: &str, attr: &str) -> String {
    let pattern = format!("{}=\"", attr);
    let mut out = String::new();
    let mut rest = s;
    while let Some(attr_i) = rest.find(&pattern) {
        let val_start = attr_i + pattern.len();
        let Some(val_end) = rest[val_start..].find('"') else {
            out.push_str(rest);
            return out;
        };
        let cond = rest[val_start..val_start + val_end].trim().to_string();
        if cond.is_empty() {
            out.push_str(&rest[..val_start + val_end + 1]);
            rest = &rest[val_start + val_end + 1..];
            continue;
        }
        let Some(tag_start) = rest[..attr_i].rfind('<') else {
            out.push_str(&rest[..val_start + val_end + 1]);
            rest = &rest[val_start + val_end + 1..];
            continue;
        };
        let Some(elem_len) = element_span_len(&rest[tag_start..]) else {
            out.push_str(&rest[..val_start + val_end + 1]);
            rest = &rest[val_start + val_end + 1..];
            continue;
        };
        let elem_end = tag_start + elem_len;
        let mut elem = rest[tag_start..elem_end].to_string();
        elem = strip_attr_prefix(&elem, attr);
        out.push_str(&rest[..tag_start]);
        out.push('{');
        out.push_str(&cond);
        out.push_str(" && (\n");
        out.push_str(elem.trim());
        out.push_str("\n)}");
        rest = &rest[elem_end..];
    }
    out.push_str(rest);
    out
}

/// `{#if visible}…{/if}` → `{visible && (…)}`
fn rewrite_svelte_if(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find("{#if ") {
        out.push_str(&rest[..start]);
        let after = start + "{#if ".len();
        let Some(header_end) = rest[after..].find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let cond = rest[after..after + header_end].trim();
        let body_start = after + header_end + 1;
        // Prefer {/if}; allow {:else} by taking only before else
        let end_marker = if let Some(e) = rest[body_start..].find("{:else") {
            let else_abs = body_start + e;
            if let Some(close) = rest[else_abs..].find("{/if}") {
                else_abs + close + "{/if}".len()
            } else {
                out.push_str(&rest[start..]);
                return out;
            }
        } else if let Some(close) = rest[body_start..].find("{/if}") {
            body_start + close + "{/if}".len()
        } else {
            out.push_str(&rest[start..]);
            return out;
        };
        let body_end = rest[body_start..end_marker]
            .find("{:else")
            .map(|i| body_start + i)
            .unwrap_or(end_marker - "{/if}".len());
        let body = rest[body_start..body_end].trim();
        out.push('{');
        out.push_str(cond);
        out.push_str(" && (\n");
        out.push_str(body);
        out.push_str("\n)}");
        rest = &rest[end_marker..];
    }
    out.push_str(rest);
    out
}

/// Length of one HTML/JSX element starting at `s[0] == '<'`.
fn element_span_len(s: &str) -> Option<usize> {
    if !s.starts_with('<') || s.starts_with("</") {
        return None;
    }
    let name_end = s[1..]
        .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
        .map(|i| i + 1)?;
    let tag = &s[1..name_end];
    if tag.is_empty() {
        return None;
    }
    // Find end of opening tag
    let mut i = name_end;
    let bytes = s.as_bytes();
    let mut in_quote: Option<u8> = None;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = in_quote {
            if b == q {
                in_quote = None;
            }
            i += 1;
            continue;
        }
        if b == b'"' || b == b'\'' {
            in_quote = Some(b);
            i += 1;
            continue;
        }
        if b == b'>' {
            // self-closing?
            let self_close = i > 0 && bytes[i - 1] == b'/';
            if self_close {
                return Some(i + 1);
            }
            i += 1;
            break;
        }
        i += 1;
    }
    // Match nested close tag
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let mut depth = 1i32;
    while i < s.len() {
        if s[i..].starts_with(&close) {
            depth -= 1;
            if depth == 0 {
                return Some(i + close.len());
            }
            i += close.len();
            continue;
        }
        if s[i..].starts_with(&open) {
            let after = i + open.len();
            let next = s.as_bytes().get(after).copied().unwrap_or(0);
            if next.is_ascii_whitespace() || next == b'>' || next == b'/' {
                depth += 1;
            }
        }
        i += 1;
    }
    None
}

/// `{#each items as item}…{/each}` → `{items.map((item) => (…))}`
fn rewrite_svelte_each(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find("{#each ") {
        out.push_str(&rest[..start]);
        let after = start + "{#each ".len();
        let Some(header_end) = rest[after..].find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let header = rest[after..after + header_end].trim();
        let body_start = after + header_end + 1;
        let Some(end_rel) = rest[body_start..].find("{/each}") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let body = rest[body_start..body_start + end_rel].trim();
        let end = body_start + end_rel + "{/each}".len();
        // items as item | items as item, i
        let Some((coll, right)) = header.split_once(" as ") else {
            out.push_str(&rest[start..end]);
            rest = &rest[end..];
            continue;
        };
        let item = right.split(',').next().unwrap_or(right).trim();
        let coll = coll.trim();
        out.push('{');
        out.push_str(coll);
        out.push_str(".map((");
        out.push_str(item);
        out.push_str(") => (\n");
        out.push_str(body);
        out.push_str("\n))}");
        rest = &rest[end..];
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

#[cfg(test)]
mod map_tests {
    use aether_ir::{AppBindings, ControlFlow, HandlerBinding};
    use crate::parse_jsx_with_bindings;

    #[test]
    fn parse_items_map_to_loop() {
        let src = r#"
export default function App() {
  return (
    <ul>
      {items.map((item) => (
        <li className="row">row</li>
      ))}
    </ul>
  );
}
"#;
        let mut bindings = AppBindings::default();
        bindings.handlers.insert(
            "inc_items".into(),
            HandlerBinding {
                op: "inc".into(),
                slot: Some("items".into()),
                delta: Some(1),
                server: false,
                effect: None,
                into: None,
            },
        );
        let prog = parse_jsx_with_bindings(src, &bindings).expect("parse");
        let loops: Vec<_> = prog
            .nodes
            .iter()
            .filter(|n| matches!(n.control_flow, ControlFlow::Loop(_, _)))
            .collect();
        assert!(
            !loops.is_empty(),
            "expected Loop control_flow, nodes={:?}",
            prog.nodes
                .iter()
                .map(|n| format!("{:?} {:?}", n.id, n.control_flow))
                .collect::<Vec<_>>()
        );
        assert!(
            prog.slots.iter().any(|s| s.name == "items"),
            "items slot missing: {:?}",
            prog.slots.iter().map(|s| &s.name).collect::<Vec<_>>()
        );
    }

    #[test]
    fn vue_v_for_to_loop() {
        let vue = r#"
<template>
  <ul>
    <li v-for="item in items" class="row">row</li>
  </ul>
</template>
"#;
        let mut bindings = AppBindings::default();
        bindings.handlers.insert(
            "inc_items".into(),
            HandlerBinding {
                op: "inc".into(),
                slot: Some("items".into()),
                delta: Some(1),
                server: false,
                effect: None,
                into: None,
            },
        );
        let prog = crate::parsers::parse_vue_sfc(vue, &bindings).expect("vue");
        assert!(
            prog.nodes
                .iter()
                .any(|n| matches!(n.control_flow, ControlFlow::Loop(_, _))),
            "expected Loop from v-for"
        );
    }

    #[test]
    fn svelte_each_to_loop() {
        let src = r#"
<ul>
{#each items as item}
  <li class="row">row</li>
{/each}
</ul>
"#;
        let mut bindings = AppBindings::default();
        bindings.handlers.insert(
            "inc_items".into(),
            HandlerBinding {
                op: "inc".into(),
                slot: Some("items".into()),
                delta: Some(1),
                server: false,
                effect: None,
                into: None,
            },
        );
        let prog = crate::parsers::parse_svelte(src, &bindings).expect("svelte");
        assert!(
            prog.nodes
                .iter()
                .any(|n| matches!(n.control_flow, ControlFlow::Loop(_, _))),
            "expected Loop from #each"
        );
    }

    #[test]
    fn angular_ng_for_to_loop() {
        let ng = r#"
<ul>
  <li *ngFor="let item of items" class="row">row</li>
</ul>
"#;
        let mut bindings = AppBindings::default();
        bindings.handlers.insert(
            "inc_items".into(),
            HandlerBinding {
                op: "inc".into(),
                slot: Some("items".into()),
                delta: Some(1),
                server: false,
                effect: None,
                into: None,
            },
        );
        let prog = crate::parsers::parse_angular_template(ng, &bindings).expect("angular");
        assert!(
            prog.nodes
                .iter()
                .any(|n| matches!(n.control_flow, ControlFlow::Loop(_, _))),
            "expected Loop from *ngFor"
        );
    }

    #[test]
    fn jsx_and_condition() {
        let src = r#"
export default function App() {
  return (
    <div>
      {visible && (
        <p className="panel">hi</p>
      )}
    </div>
  );
}
"#;
        let mut bindings = AppBindings::default();
        bindings.handlers.insert(
            "toggle_visible".into(),
            HandlerBinding {
                op: "inc".into(),
                slot: Some("visible".into()),
                delta: Some(1),
                server: false,
                effect: None,
                into: None,
            },
        );
        let prog = parse_jsx_with_bindings(src, &bindings).expect("parse");
        assert!(
            prog.nodes
                .iter()
                .any(|n| matches!(n.control_flow, ControlFlow::Condition(_))),
            "expected Condition control_flow"
        );
    }

    #[test]
    fn map_item_becomes_expression() {
        let src = r#"
export default function App() {
  return (
    <ul>
      {items.map((item) => (
        <li>{item}</li>
      ))}
    </ul>
  );
}
"#;
        let mut bindings = AppBindings::default();
        bindings.handlers.insert(
            "inc_items".into(),
            HandlerBinding {
                op: "inc".into(),
                slot: Some("items".into()),
                delta: Some(1),
                server: false,
                effect: None,
                into: None,
            },
        );
        let prog = parse_jsx_with_bindings(src, &bindings).expect("parse");
        use aether_ir::{Binding, NodeType};
        let has_item = prog.nodes.iter().any(|n| {
            matches!(
                &n.node_type,
                NodeType::Text(Binding::Expression(e)) if e == "$item"
            )
        });
        assert!(has_item, "expected $item Expression binding in loop body");
    }
}
