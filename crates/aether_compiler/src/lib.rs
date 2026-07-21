use aether_ir::{
    resolve_handler, AetherNode, AetherProgram, AppBindings, Binding, ControlFlow, DerivedOp,
    DerivedSlot, EventHandler, NodeId, NodeType, ReactiveEdge, Slot, SlotId, SlotKind,
    HEADER_SIZE, MIN_MEMORY_BYTES, SLOT_I32_SIZE,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use swc_common::{errors::Handler, sync::Lrc, FileName, SourceMap};
use swc_ecma_ast::{
    Callee, Expr, JSXAttrOrSpread, JSXAttrValue, JSXElement, JSXElementChild, JSXElementName,
    JSXExpr, Lit, MemberProp, ModuleItem, Pat,
};
use swc_ecma_parser::{lexer::Lexer, Parser, StringInput, Syntax, TsConfig};

pub mod codegen;
pub mod parsers;

struct IdGen {
    next: u32,
}

impl IdGen {
    fn new() -> Self {
        Self { next: 0 }
    }
    fn next_node(&mut self) -> NodeId {
        let id = NodeId(self.next);
        self.next += 1;
        id
    }
}

/// Parse JSX/TSX source into a lowered `AetherProgram`.
pub fn parse_jsx(source_code: &str) -> Result<AetherProgram, String> {
    parse_jsx_with_bindings(source_code, &AppBindings::default())
}

pub fn parse_jsx_with_bindings(
    source_code: &str,
    bindings: &AppBindings,
) -> Result<AetherProgram, String> {
    let mut ids = IdGen::new();
    let mut nodes: Vec<AetherNode> = Vec::new();
    let root = parse_module_root(source_code, &mut ids, &mut nodes)?;
    Ok(lower_program(root, nodes, bindings))
}

fn parse_module_root(
    source_code: &str,
    ids: &mut IdGen,
    nodes: &mut Vec<AetherNode>,
) -> Result<NodeId, String> {
    let cm = Lrc::new(SourceMap::default());
    let _handler = Handler::with_emitter_writer(Box::new(std::io::stderr()), Some(cm.clone()));
    let fm = cm.new_source_file(
        FileName::Custom("component.tsx".into()),
        source_code.to_string(),
    );
    let lexer = Lexer::new(
        Syntax::Typescript(TsConfig {
            tsx: true,
            ..Default::default()
        }),
        Default::default(),
        StringInput::from(&*fm),
        None,
    );
    let mut parser = Parser::new_from(lexer);
    let module = parser
        .parse_module()
        .map_err(|e| format!("Ошибка парсинга SWC: {:?}", e))?;

    for item in &module.body {
        if let ModuleItem::Stmt(stmt) = item {
            if let Some(expr_stmt) = stmt.as_expr() {
                if let Some(jsx_expr) = expr_stmt.expr.as_jsx_element() {
                    return Ok(transform_jsx(jsx_expr, ids, nodes));
                }
            }
        }

        if let ModuleItem::ModuleDecl(swc_ecma_ast::ModuleDecl::ExportDefaultDecl(decl)) = item {
            if let swc_ecma_ast::DefaultDecl::Fn(fn_expr) = &decl.decl {
                if let Some(block_stmt) = &fn_expr.function.body {
                    for stmt in &block_stmt.stmts {
                        if let swc_ecma_ast::Stmt::Return(return_stmt) = stmt {
                            if let Some(arg_expr) = &return_stmt.arg {
                                let mut final_expr = &**arg_expr;
                                if let Expr::Paren(paren_expr) = final_expr {
                                    final_expr = &*paren_expr.expr;
                                }
                                if let Some(jsx_expr) = final_expr.as_jsx_element() {
                                    return Ok(transform_jsx(jsx_expr, ids, nodes));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Err("JSX элемент не найден в структуре TSX-модуля".to_string())
}

fn ensure_slot(nodes: &mut Vec<AetherNode>, id: NodeId) {
    while nodes.len() <= id.0 as usize {
        let pad = NodeId(nodes.len() as u32);
        nodes.push(AetherNode {
            id: pad,
            node_type: NodeType::Text(Binding::Static(String::new())),
            control_flow: ControlFlow::None,
            children: vec![],
        });
    }
}

fn transform_jsx(jsx: &JSXElement, ids: &mut IdGen, nodes: &mut Vec<AetherNode>) -> NodeId {
    let mut props = HashMap::new();
    let mut events = HashMap::new();

    let tag_name = match &jsx.opening.name {
        JSXElementName::Ident(ident) => ident.sym.to_string(),
        _ => "div".to_string(),
    };

    for attr_or_spread in &jsx.opening.attrs {
        if let JSXAttrOrSpread::JSXAttr(attr) = attr_or_spread {
            let attr_name = match &attr.name {
                swc_ecma_ast::JSXAttrName::Ident(id) => id.sym.to_string(),
                _ => continue,
            };
            if let Some(value) = &attr.value {
                match value {
                    JSXAttrValue::Lit(Lit::Str(s)) => {
                        props.insert(attr_name, Binding::Static(s.value.to_string()));
                    }
                    JSXAttrValue::JSXExprContainer(container) => {
                        if let JSXExpr::Expr(expr) = &container.expr {
                            if let Expr::Ident(ident) = &**expr {
                                let var_name = ident.sym.to_string();
                                if attr_name.starts_with("on") {
                                    let event_name =
                                        attr_name.trim_start_matches("on").to_lowercase();
                                    if var_name.starts_with("server_") {
                                        events.insert(event_name, EventHandler::Server(var_name));
                                    } else {
                                        events.insert(event_name, EventHandler::Local(var_name));
                                    }
                                } else {
                                    props.insert(attr_name, Binding::Reactive(var_name));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // PascalCase → resolve from AETHER_COMPONENTS_DIR or {root}/src
    if !tag_name.is_empty() && tag_name.chars().next().unwrap().is_uppercase() {
        if let Ok(root_dir) = std::env::var("AETHER_PROJECT_ROOT") {
            let components = std::env::var("AETHER_COMPONENTS_DIR")
                .unwrap_or_else(|_| "src".to_string());
            let component_path = Path::new(&root_dir)
                .join(&components)
                .join(format!("{}.tsx", tag_name));
            if component_path.exists() {
                if let Ok(nested_source) = fs::read_to_string(&component_path) {
                    if let Ok(nested_root) = parse_module_root(&nested_source, ids, nodes) {
                        return nested_root;
                    }
                }
            }
        }
    }

    let node_id = ids.next_node();
    ensure_slot(nodes, node_id);

    let mut child_ids = Vec::new();
    for child in &jsx.children {
        match child {
            JSXElementChild::JSXText(jsx_text) => {
                let text_content = jsx_text.value.trim();
                if !text_content.is_empty() {
                    let text_id = ids.next_node();
                    ensure_slot(nodes, text_id);
                    nodes[text_id.0 as usize] = AetherNode {
                        id: text_id,
                        node_type: NodeType::Text(Binding::Static(text_content.to_string())),
                        control_flow: ControlFlow::None,
                        children: vec![],
                    };
                    child_ids.push(text_id);
                }
            }
            JSXElementChild::JSXExprContainer(container) => {
                if let JSXExpr::Expr(expr) = &container.expr {
                    if let Expr::Ident(ident) = &**expr {
                        let text_id = ids.next_node();
                        ensure_slot(nodes, text_id);
                        nodes[text_id.0 as usize] = AetherNode {
                            id: text_id,
                            node_type: NodeType::Text(Binding::Reactive(ident.sym.to_string())),
                            control_flow: ControlFlow::None,
                            children: vec![],
                        };
                        child_ids.push(text_id);
                    } else if let Some(loop_id) = try_transform_map(expr, ids, nodes) {
                        child_ids.push(loop_id);
                    } else if let Some(cond_id) = try_transform_condition(expr, ids, nodes) {
                        child_ids.push(cond_id);
                    }
                }
            }
            JSXElementChild::JSXElement(nested_jsx) => {
                child_ids.push(transform_jsx(nested_jsx, ids, nodes));
            }
            _ => {}
        }
    }

    nodes[node_id.0 as usize] = AetherNode {
        id: node_id,
        node_type: NodeType::Element {
            tag: tag_name,
            props,
            events,
        },
        control_flow: ControlFlow::None,
        children: child_ids,
    };

    node_id
}

/// `{items.map((item) => <li>…</li>)}` → template node with ControlFlow::Loop(items, item).
fn try_transform_map(
    expr: &Expr,
    ids: &mut IdGen,
    nodes: &mut Vec<AetherNode>,
) -> Option<NodeId> {
    let Expr::Call(call) = expr else {
        return None;
    };
    let Callee::Expr(callee) = &call.callee else {
        return None;
    };
    let Expr::Member(member) = &**callee else {
        return None;
    };
    let MemberProp::Ident(prop) = &member.prop else {
        return None;
    };
    if prop.sym.as_ref() != "map" {
        return None;
    }
    // `items.map` or Solid `items().map`
    let collection = match &*member.obj {
        Expr::Ident(obj) => obj.sym.to_string(),
        Expr::Call(inner) => {
            let Callee::Expr(cal) = &inner.callee else {
                return None;
            };
            let Expr::Ident(id) = &**cal else {
                return None;
            };
            if !inner.args.is_empty() {
                return None;
            }
            id.sym.to_string()
        }
        _ => return None,
    };
    let arg0 = call.args.first()?;
    let (item_name, body_jsx) = extract_map_callback(&arg0.expr)?;
    let template_id = transform_jsx(body_jsx, ids, nodes);
    // Mark the template root as a loop body keyed by collection length slot.
    nodes[template_id.0 as usize].control_flow = ControlFlow::Loop(collection.clone(), item_name.clone());
    // Item idents inside the template → Expression("$item") for per-row patch (index / packed).
    rewrite_loop_item_bindings(nodes, template_id, &item_name);
    Some(template_id)
}

/// `{visible && <div/>}` → template with ControlFlow::Condition(visible).
fn try_transform_condition(
    expr: &Expr,
    ids: &mut IdGen,
    nodes: &mut Vec<AetherNode>,
) -> Option<NodeId> {
    let Expr::Bin(bin) = expr else {
        return None;
    };
    if !matches!(bin.op, swc_ecma_ast::BinaryOp::LogicalAnd) {
        return None;
    }
    let Expr::Ident(cond) = &*bin.left else {
        return None;
    };
    let jsx = jsx_from_expr(&bin.right)?;
    let template_id = transform_jsx(jsx, ids, nodes);
    nodes[template_id.0 as usize].control_flow =
        ControlFlow::Condition(cond.sym.to_string());
    Some(template_id)
}

/// Rewrite Reactive(item) under a Loop template to Expression("$item").
fn rewrite_loop_item_bindings(nodes: &mut [AetherNode], root: NodeId, item_name: &str) {
    let mut stack = vec![root];
    while let Some(id) = stack.pop() {
        let idx = id.0 as usize;
        if idx >= nodes.len() {
            continue;
        }
        let children = nodes[idx].children.clone();
        match &nodes[idx].node_type {
            NodeType::Text(Binding::Reactive(name)) if name == item_name => {
                nodes[idx].node_type = NodeType::Text(Binding::Expression("$item".into()));
            }
            NodeType::Element { .. } => {
                if let NodeType::Element { props, .. } = &mut nodes[idx].node_type {
                    for binding in props.values_mut() {
                        if let Binding::Reactive(name) = binding {
                            if name == item_name {
                                *binding = Binding::Expression("$item".into());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        for child in children {
            stack.push(child);
        }
    }
}

fn extract_map_callback(expr: &Expr) -> Option<(String, &JSXElement)> {
    match expr {
        Expr::Arrow(arrow) => {
            let item = match arrow.params.first() {
                Some(Pat::Ident(id)) => id.id.sym.to_string(),
                _ => "_".to_string(),
            };
            let jsx = match &*arrow.body {
                swc_ecma_ast::BlockStmtOrExpr::Expr(e) => jsx_from_expr(e)?,
                swc_ecma_ast::BlockStmtOrExpr::BlockStmt(block) => {
                    let stmt = block.stmts.last()?;
                    match stmt {
                        swc_ecma_ast::Stmt::Return(ret) => {
                            jsx_from_expr(ret.arg.as_ref()?.as_ref())?
                        }
                        swc_ecma_ast::Stmt::Expr(es) => jsx_from_expr(&es.expr)?,
                        _ => return None,
                    }
                }
            };
            Some((item, jsx))
        }
        Expr::Fn(f) => {
            let item = match f.function.params.first().map(|p| &p.pat) {
                Some(Pat::Ident(id)) => id.id.sym.to_string(),
                _ => "_".to_string(),
            };
            let block = f.function.body.as_ref()?;
            let stmt = block.stmts.last()?;
            let jsx = match stmt {
                swc_ecma_ast::Stmt::Return(ret) => jsx_from_expr(ret.arg.as_ref()?.as_ref())?,
                _ => return None,
            };
            Some((item, jsx))
        }
        Expr::Paren(p) => extract_map_callback(&p.expr),
        _ => None,
    }
}

fn jsx_from_expr(expr: &Expr) -> Option<&JSXElement> {
    match expr {
        Expr::JSXElement(el) => Some(el),
        Expr::Paren(p) => jsx_from_expr(&p.expr),
        _ => None,
    }
}

/// Lower a flat node table into slots, edges, and effects.
pub fn lower_program(
    root: NodeId,
    nodes: Vec<AetherNode>,
    bindings: &AppBindings,
) -> AetherProgram {
    let mut reactive_names: HashSet<String> = HashSet::new();
    collect_reactive_names(&nodes, &mut reactive_names);
    // Ensure slots referenced by bindings exist even if not in JSX yet
    for d in &bindings.derived {
        reactive_names.insert(d.target.clone());
        reactive_names.insert(d.from.clone());
    }
    for h in bindings.handlers.values() {
        if let Some(s) = &h.slot {
            reactive_names.insert(s.clone());
        }
        if let Some(s) = &h.into {
            reactive_names.insert(s.clone());
        }
    }

    let mut sorted: Vec<String> = reactive_names.into_iter().collect();
    sorted.sort();

    let slots: Vec<Slot> = sorted
        .iter()
        .enumerate()
        .map(|(i, name)| Slot {
            id: SlotId(i as u32),
            name: name.clone(),
            kind: SlotKind::I32,
            offset: HEADER_SIZE + (i as u32) * SLOT_I32_SIZE,
        })
        .collect();

    let name_to_slot: HashMap<String, SlotId> =
        slots.iter().map(|s| (s.name.clone(), s.id)).collect();

    let mut edges = Vec::new();
    let mut effects = HashMap::new();

    for node in &nodes {
        match &node.node_type {
            NodeType::Text(Binding::Reactive(name)) => {
                if let Some(&slot) = name_to_slot.get(name) {
                    edges.push(ReactiveEdge::SlotToText {
                        slot,
                        node: node.id,
                    });
                }
            }
            NodeType::Element { props, events, .. } => {
                for (attr, binding) in props {
                    if let Binding::Reactive(name) = binding {
                        if let Some(&slot) = name_to_slot.get(name) {
                            edges.push(ReactiveEdge::SlotToAttr {
                                slot,
                                node: node.id,
                                attr: attr.clone(),
                            });
                        }
                    }
                }
                for (_, handler) in events {
                    let (name, is_server) = match handler {
                        EventHandler::Local(n) => (n.clone(), false),
                        EventHandler::Server(n) => (n.clone(), true),
                    };
                    if let Some(op) = resolve_handler(&name, is_server, &name_to_slot, bindings) {
                        effects.insert(name, op);
                    }
                }
            }
            _ => {}
        }
    }

    let mut derived = Vec::new();
    for d in &bindings.derived {
        let Some(&target) = name_to_slot.get(&d.target) else {
            continue;
        };
        let Some(&from) = name_to_slot.get(&d.from) else {
            continue;
        };
        let op = match d.op.as_str() {
            "mul" | "Mul" => DerivedOp::Mul(d.arg),
            "add" | "Add" => DerivedOp::Add(d.arg),
            _ => DerivedOp::Copy,
        };
        derived.push(DerivedSlot {
            target,
            sources: vec![from],
            op,
        });
    }

    let slot_count = slots.len() as u32;
    let payload = HEADER_SIZE + slot_count * SLOT_I32_SIZE;
    let memory_bytes = payload.max(MIN_MEMORY_BYTES);
    let memory_pages = ((memory_bytes + 65535) / 65536).max(1);

    let mut program = AetherProgram {
        root,
        nodes,
        slots,
        edges,
        subscribers: vec![],
        propagates_to: vec![],
        derived,
        effects,
        memory_pages,
        memory_bytes,
    };
    program.rebuild_subscribers();
    program.rebuild_propagation();
    program
}

fn collect_reactive_names(nodes: &[AetherNode], out: &mut HashSet<String>) {
    for node in nodes {
        match &node.control_flow {
            ControlFlow::Loop(collection, _) => {
                out.insert(collection.clone());
            }
            ControlFlow::Condition(name) => {
                out.insert(name.clone());
            }
            ControlFlow::None => {}
        }
        match &node.node_type {
            NodeType::Text(Binding::Reactive(name)) => {
                out.insert(name.clone());
            }
            NodeType::Element { props, .. } => {
                for (_, binding) in props {
                    if let Binding::Reactive(name) = binding {
                        out.insert(name.clone());
                    }
                }
            }
            _ => {}
        }
    }
}
