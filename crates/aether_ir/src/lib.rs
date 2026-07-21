use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

pub const MEMORY_MAGIC: u32 = 0x5248_5441;
pub const HEADER_SIZE: u32 = 8;
pub const SLOT_I32_SIZE: u32 = 4;
/// Continuation frame (effect suspend / resume) — WasmFX-ready layout in linear memory.
/// status, effect_id, resume_slot, payload, return_pc — each u32 LE.
pub const CONT_OFFSET: u32 = 192;
pub const CONT_SIZE: u32 = 20;
pub const CONT_STATUS_SUSPENDED: u32 = 1;
pub const CONT_STATUS_READY: u32 = 0;
pub const SCRATCH_OFFSET: u32 = 256;
pub const MIN_MEMORY_BYTES: u32 = 512;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SlotId(pub u32);

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId(pub u32);

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum SlotKind {
    I32,
    F64,
    Bytes,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Slot {
    pub id: SlotId,
    pub name: String,
    pub kind: SlotKind,
    pub offset: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum Binding {
    Static(String),
    Reactive(String),
    Expression(String),
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum ControlFlow {
    None,
    Condition(String),
    Loop(String, String),
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum EventHandler {
    Local(String),
    Server(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum NodeType {
    Element {
        tag: String,
        props: HashMap<String, Binding>,
        events: HashMap<String, EventHandler>,
    },
    Text(Binding),
    Component {
        name: String,
        props: HashMap<String, Binding>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AetherNode {
    pub id: NodeId,
    pub node_type: NodeType,
    pub control_flow: ControlFlow,
    pub children: Vec<NodeId>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum ReactiveEdge {
    SlotToText { slot: SlotId, node: NodeId },
    SlotToAttr {
        slot: SlotId,
        node: NodeId,
        attr: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum DerivedOp {
    Copy,
    Mul(i32),
    Add(i32),
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct DerivedSlot {
    pub target: SlotId,
    pub sources: Vec<SlotId>,
    pub op: DerivedOp,
}

/// Generic local / server / effect ops — no demo-specific shapes.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum EffectOp {
    LocalMutate { slot: SlotId, delta: i32 },
    ServerMutate {
        slot: SlotId,
        action: String,
        delta: i32,
    },
    Perform {
        effect: String,
        resume_slot: SlotId,
    },
}

/// Optional bindings supplied by CLI/config (handlers + derived).
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppBindings {
    #[serde(default)]
    pub derived: Vec<DerivedBinding>,
    #[serde(default)]
    pub handlers: HashMap<String, HandlerBinding>,
    #[serde(default)]
    pub effects: HashMap<String, i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DerivedBinding {
    pub target: String,
    pub from: String,
    pub op: String,
    #[serde(default = "default_arg")]
    pub arg: i32,
}

fn default_arg() -> i32 {
    1
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HandlerBinding {
    /// "inc" | "dec" | "add" | "perform"
    pub op: String,
    #[serde(default)]
    pub slot: Option<String>,
    #[serde(default)]
    pub delta: Option<i32>,
    #[serde(default)]
    pub server: bool,
    #[serde(default)]
    pub effect: Option<String>,
    #[serde(default)]
    pub into: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AetherProgram {
    pub root: NodeId,
    pub nodes: Vec<AetherNode>,
    pub slots: Vec<Slot>,
    pub edges: Vec<ReactiveEdge>,
    #[serde(default)]
    pub subscribers: Vec<Vec<u32>>,
    #[serde(default)]
    pub propagates_to: Vec<Vec<u32>>,
    #[serde(default)]
    pub derived: Vec<DerivedSlot>,
    pub effects: HashMap<String, EffectOp>,
    pub memory_pages: u32,
    pub memory_bytes: u32,
}

impl AetherProgram {
    pub fn rebuild_subscribers(&mut self) {
        self.subscribers = vec![Vec::new(); self.slots.len()];
        for (edge_idx, edge) in self.edges.iter().enumerate() {
            let slot = match edge {
                ReactiveEdge::SlotToText { slot, .. } => slot.0,
                ReactiveEdge::SlotToAttr { slot, .. } => slot.0,
            } as usize;
            if slot < self.subscribers.len() {
                self.subscribers[slot].push(edge_idx as u32);
            }
        }
    }

    pub fn rebuild_propagation(&mut self) {
        self.propagates_to = vec![Vec::new(); self.slots.len()];
        for d in &self.derived {
            for src in &d.sources {
                let s = src.0 as usize;
                if s < self.propagates_to.len() {
                    self.propagates_to[s].push(d.target.0);
                }
            }
        }
    }

    pub fn dirty_closure(&self, root: SlotId) -> Vec<SlotId> {
        let mut seen = HashSet::new();
        let mut q = VecDeque::new();
        let mut out = Vec::new();
        q.push_back(root);
        while let Some(s) = q.pop_front() {
            if !seen.insert(s.0) {
                continue;
            }
            out.push(s);
            if let Some(next) = self.propagates_to.get(s.0 as usize) {
                for &t in next {
                    q.push_back(SlotId(t));
                }
            }
        }
        out
    }

    pub fn allocate_memory(&self) -> Vec<u8> {
        let mut mem = vec![0u8; self.memory_bytes as usize];
        mem[0..4].copy_from_slice(&MEMORY_MAGIC.to_le_bytes());
        mem[4..8].copy_from_slice(&(self.slots.len() as u32).to_le_bytes());
        mem
    }

    pub fn write_i32_slot(&self, mem: &mut [u8], slot: SlotId, value: i32) {
        if let Some(s) = self.slots.iter().find(|s| s.id == slot) {
            let off = s.offset as usize;
            if off + 4 <= mem.len() {
                mem[off..off + 4].copy_from_slice(&value.to_le_bytes());
            }
        }
    }

    pub fn read_i32_slot(&self, mem: &[u8], slot: SlotId) -> i32 {
        self.slots
            .iter()
            .find(|s| s.id == slot)
            .map(|s| {
                let off = s.offset as usize;
                i32::from_le_bytes(mem[off..off + 4].try_into().unwrap_or([0; 4]))
            })
            .unwrap_or(0)
    }

    pub fn slot_by_name(&self, name: &str) -> Option<&Slot> {
        self.slots.iter().find(|s| s.name == name)
    }

    pub fn recompute_derived(&self, mem: &mut [u8], dirty: SlotId) {
        let closure: HashSet<u32> = self.dirty_closure(dirty).iter().map(|s| s.0).collect();
        for d in &self.derived {
            if !closure.contains(&d.target.0) {
                continue;
            }
            let src = d.sources.first().copied().unwrap_or(SlotId(0));
            let v = self.read_i32_slot(mem, src);
            let out = match d.op {
                DerivedOp::Copy => v,
                DerivedOp::Mul(k) => v.saturating_mul(k),
                DerivedOp::Add(k) => v.saturating_add(k),
            };
            self.write_i32_slot(mem, d.target, out);
        }
    }
}

pub fn encode_deltas(deltas: &[(u32, i32)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(deltas.len() * 12);
    for &(slot_id, value) in deltas {
        out.extend_from_slice(&slot_id.to_le_bytes());
        out.extend_from_slice(&4u32.to_le_bytes());
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

pub fn decode_deltas(bytes: &[u8]) -> Vec<(u32, i32)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 8 <= bytes.len() {
        let slot_id = u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
        let len = u32::from_le_bytes(bytes[i + 4..i + 8].try_into().unwrap()) as usize;
        i += 8;
        if i + len > bytes.len() {
            break;
        }
        let value = if len >= 4 {
            i32::from_le_bytes(bytes[i..i + 4].try_into().unwrap())
        } else {
            0
        };
        out.push((slot_id, value));
        i += len;
    }
    out
}

pub fn encode_effect_request(effect: &str, resume_slot: u32, payload: i32) -> Vec<u8> {
    let name = effect.as_bytes();
    let mut out = Vec::with_capacity(2 + name.len() + 8);
    out.extend_from_slice(&(name.len() as u16).to_le_bytes());
    out.extend_from_slice(name);
    out.extend_from_slice(&resume_slot.to_le_bytes());
    out.extend_from_slice(&payload.to_le_bytes());
    out
}

pub fn decode_effect_request(bytes: &[u8]) -> Option<(String, u32, i32)> {
    if bytes.len() < 2 {
        return None;
    }
    let n = u16::from_le_bytes(bytes[0..2].try_into().ok()?) as usize;
    if bytes.len() < 2 + n + 8 {
        return None;
    }
    let name = String::from_utf8_lossy(&bytes[2..2 + n]).into_owned();
    let resume = u32::from_le_bytes(bytes[2 + n..2 + n + 4].try_into().ok()?);
    let payload = i32::from_le_bytes(bytes[2 + n + 4..2 + n + 8].try_into().ok()?);
    Some((name, resume, payload))
}

/// Resolve a handler name using bindings first, then generic conventions:
/// - `inc_<slot>` / `dec_<slot>`
/// - `server_inc_<slot>`
/// - `perform_<effect>__into_<slot>`
pub fn resolve_handler(
    name: &str,
    server: bool,
    slots: &HashMap<String, SlotId>,
    bindings: &AppBindings,
) -> Option<EffectOp> {
    if let Some(h) = bindings.handlers.get(name) {
        return binding_to_op(h, slots);
    }

    if let Some(rest) = name.strip_prefix("perform_") {
        if let Some((effect, slot_name)) = rest.split_once("__into_") {
            let resume = *slots.get(slot_name)?;
            return Some(EffectOp::Perform {
                effect: effect.replace('_', "."),
                resume_slot: resume,
            });
        }
    }

    if let Some(slot_name) = name.strip_prefix("inc_") {
        let slot = *slots.get(slot_name)?;
        return Some(if server {
            EffectOp::ServerMutate {
                slot,
                action: name.to_string(),
                delta: 1,
            }
        } else {
            EffectOp::LocalMutate { slot, delta: 1 }
        });
    }

    if let Some(slot_name) = name.strip_prefix("dec_") {
        let slot = *slots.get(slot_name)?;
        return Some(if server {
            EffectOp::ServerMutate {
                slot,
                action: name.to_string(),
                delta: -1,
            }
        } else {
            EffectOp::LocalMutate { slot, delta: -1 }
        });
    }

    if let Some(rest) = name.strip_prefix("server_inc_") {
        let slot = *slots.get(rest)?;
        return Some(EffectOp::ServerMutate {
            slot,
            action: name.to_string(),
            delta: 1,
        });
    }

    // Bare server_* without mapping: no silent count fallback
    if server {
        return None;
    }
    None
}

fn binding_to_op(h: &HandlerBinding, slots: &HashMap<String, SlotId>) -> Option<EffectOp> {
    match h.op.as_str() {
        "perform" => {
            let effect = h.effect.clone()?;
            let into = h.into.as_ref()?;
            let resume = *slots.get(into)?;
            Some(EffectOp::Perform {
                effect,
                resume_slot: resume,
            })
        }
        "inc" | "dec" | "add" => {
            let slot_name = h.slot.as_ref()?;
            let slot = *slots.get(slot_name)?;
            let delta = h.delta.unwrap_or(if h.op == "dec" { -1 } else { 1 });
            if h.server {
                Some(EffectOp::ServerMutate {
                    slot,
                    action: format!("{}_{}", h.op, slot_name),
                    delta,
                })
            } else {
                Some(EffectOp::LocalMutate { slot, delta })
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_inc_convention() {
        let mut slots = HashMap::new();
        slots.insert("score".into(), SlotId(3));
        let op = resolve_handler("inc_score", false, &slots, &AppBindings::default()).unwrap();
        assert_eq!(op, EffectOp::LocalMutate { slot: SlotId(3), delta: 1 });
    }

    #[test]
    fn resolve_perform_into() {
        let mut slots = HashMap::new();
        slots.insert("result".into(), SlotId(2));
        let op =
            resolve_handler("perform_db_get__into_result", false, &slots, &AppBindings::default())
                .unwrap();
        assert!(matches!(
            op,
            EffectOp::Perform {
                resume_slot: SlotId(2),
                ..
            }
        ));
    }

    #[test]
    fn no_silent_count_fallback() {
        let slots = HashMap::new();
        assert!(resolve_handler("localClick", false, &slots, &AppBindings::default()).is_none());
    }
}
