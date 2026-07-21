use aether_ir::{
    AetherProgram, EffectOp, ReactiveEdge, CONT_OFFSET, CONT_STATUS_SUSPENDED, HEADER_SIZE,
    SCRATCH_OFFSET, SLOT_I32_SIZE,
};
use std::collections::HashMap;
use wasm_encoder::{
    CodeSection, ConstExpr, CustomSection, ExportKind, ExportSection, Function, FunctionSection,
    GlobalSection, GlobalType, HeapType, ImportSection, Instruction, MemArg, MemorySection,
    MemoryType, Module, RefType, StorageType, TypeSection, ValType,
};

pub struct WasmGenerator {
    module: Module,
}

impl WasmGenerator {
    pub fn new() -> Self {
        Self {
            module: Module::new(),
        }
    }

    pub fn generate(&mut self, program: &AetherProgram) -> Vec<u8> {
        self.generate_inner(program, false)
    }

    /// Real WasmGC: GC array heap for slots + linear memory mirror for snapshots/DSM.
    pub fn generate_with_gc(&mut self, program: &AetherProgram) -> Vec<u8> {
        self.generate_inner(program, true)
    }

    fn generate_inner(&mut self, program: &AetherProgram, with_gc: bool) -> Vec<u8> {
        self.module = Module::new();

        let mut types = TypeSection::new();
        // 0: apply_delta(slot_id, value)
        types.function(vec![ValType::I32, ValType::I32], vec![]);
        // 1: aether_init()
        types.function(vec![], vec![]);
        // 2: event handler ()
        types.function(vec![], vec![]);
        // 3: dom_set_text
        types.function(vec![ValType::I32, ValType::I32, ValType::I32], vec![]);
        // 4: dom_set_attr
        types.function(
            vec![
                ValType::I32,
                ValType::I32,
                ValType::I32,
                ValType::I32,
                ValType::I32,
            ],
            vec![],
        );
        // 5: aether_suspend(effect_id, resume_slot, payload)
        types.function(vec![ValType::I32, ValType::I32, ValType::I32], vec![]);

        let array_type_idx = if with_gc {
            // 6: array (mut i32) — WasmGC slot heap
            types.array(&StorageType::Val(ValType::I32), true);
            Some(6u32)
        } else {
            None
        };

        let mut imports = ImportSection::new();
        imports.import("env", "dom_set_text", wasm_encoder::EntityType::Function(3));
        imports.import("env", "dom_set_attr", wasm_encoder::EntityType::Function(4));
        imports.import(
            "env",
            "aether_suspend",
            wasm_encoder::EntityType::Function(5),
        );

        const DOM_SET_TEXT: u32 = 0;
        const DOM_SET_ATTR: u32 = 1;
        const AETHER_SUSPEND: u32 = 2;
        const APPLY_DELTA_FN: u32 = 3;
        const AETHER_INIT_FN: u32 = 4;

        let mut functions = FunctionSection::new();
        let mut code = CodeSection::new();
        let mut exports = ExportSection::new();
        let mut globals = GlobalSection::new();

        if let Some(arr_ty) = array_type_idx {
            let array_ref = ValType::Ref(RefType {
                nullable: true,
                heap_type: HeapType::Concrete(arr_ty),
            });
            globals.global(
                GlobalType {
                    val_type: array_ref,
                    mutable: true,
                },
                &ConstExpr::ref_null(HeapType::Concrete(arr_ty)),
            );
        }

        let mut memories = MemorySection::new();
        memories.memory(MemoryType {
            minimum: program.memory_pages as u64,
            maximum: None,
            shared: false,
            memory64: false,
        });

        // apply_delta
        functions.function(0);
        let mut apply = Function::new(vec![]);
        // linear mirror (snapshots / DSM)
        apply.instruction(&Instruction::I32Const(HEADER_SIZE as i32));
        apply.instruction(&Instruction::LocalGet(0));
        apply.instruction(&Instruction::I32Const(SLOT_I32_SIZE as i32));
        apply.instruction(&Instruction::I32Mul);
        apply.instruction(&Instruction::I32Add);
        apply.instruction(&Instruction::LocalGet(1));
        apply.instruction(&Instruction::I32Store(MemArg {
            offset: 0,
            align: 2,
            memory_index: 0,
        }));

        if let Some(arr_ty) = array_type_idx {
            // GC heap: array.set $slots[slot] = value
            apply.instruction(&Instruction::GlobalGet(0));
            apply.instruction(&Instruction::LocalGet(0));
            apply.instruction(&Instruction::LocalGet(1));
            apply.instruction(&Instruction::ArraySet(arr_ty));
        }

        let scratch = SCRATCH_OFFSET as i32;
        for (slot_id, edge_idxs) in program.subscribers.iter().enumerate() {
            for &edge_idx in edge_idxs {
                let edge = &program.edges[edge_idx as usize];
                match edge {
                    ReactiveEdge::SlotToText { node, .. } => {
                        apply.instruction(&Instruction::LocalGet(0));
                        apply.instruction(&Instruction::I32Const(slot_id as i32));
                        apply.instruction(&Instruction::I32Eq);
                        apply.instruction(&Instruction::If(wasm_encoder::BlockType::Empty));
                        apply.instruction(&Instruction::I32Const(scratch));
                        apply.instruction(&Instruction::LocalGet(1));
                        apply.instruction(&Instruction::I32Store(MemArg {
                            offset: 0,
                            align: 2,
                            memory_index: 0,
                        }));
                        apply.instruction(&Instruction::I32Const(node.0 as i32));
                        apply.instruction(&Instruction::I32Const(scratch));
                        apply.instruction(&Instruction::I32Const(4));
                        apply.instruction(&Instruction::Call(DOM_SET_TEXT));
                        apply.instruction(&Instruction::End);
                    }
                    ReactiveEdge::SlotToAttr { node, attr, .. } => {
                        apply.instruction(&Instruction::LocalGet(0));
                        apply.instruction(&Instruction::I32Const(slot_id as i32));
                        apply.instruction(&Instruction::I32Eq);
                        apply.instruction(&Instruction::If(wasm_encoder::BlockType::Empty));
                        apply.instruction(&Instruction::I32Const(scratch));
                        apply.instruction(&Instruction::LocalGet(1));
                        apply.instruction(&Instruction::I32Store(MemArg {
                            offset: 0,
                            align: 2,
                            memory_index: 0,
                        }));
                        let name_bytes = attr.as_bytes();
                        let name_ptr = scratch + 16;
                        for (i, b) in name_bytes.iter().enumerate() {
                            apply.instruction(&Instruction::I32Const(name_ptr + i as i32));
                            apply.instruction(&Instruction::I32Const(*b as i32));
                            apply.instruction(&Instruction::I32Store8(MemArg {
                                offset: 0,
                                align: 0,
                                memory_index: 0,
                            }));
                        }
                        apply.instruction(&Instruction::I32Const(node.0 as i32));
                        apply.instruction(&Instruction::I32Const(name_ptr));
                        apply.instruction(&Instruction::I32Const(name_bytes.len() as i32));
                        apply.instruction(&Instruction::I32Const(scratch));
                        apply.instruction(&Instruction::I32Const(4));
                        apply.instruction(&Instruction::Call(DOM_SET_ATTR));
                        apply.instruction(&Instruction::End);
                    }
                }
            }
        }
        apply.instruction(&Instruction::End);
        code.function(&apply);
        exports.export("apply_delta", ExportKind::Func, APPLY_DELTA_FN);

        // aether_init
        functions.function(1);
        let mut init = Function::new(vec![]);
        if let Some(arr_ty) = array_type_idx {
            init.instruction(&Instruction::I32Const(program.slots.len() as i32));
            init.instruction(&Instruction::ArrayNewDefault(arr_ty));
            init.instruction(&Instruction::GlobalSet(0));
        }
        init.instruction(&Instruction::I32Const(0));
        init.instruction(&Instruction::I32Const(aether_ir::MEMORY_MAGIC as i32));
        init.instruction(&Instruction::I32Store(MemArg {
            offset: 0,
            align: 2,
            memory_index: 0,
        }));
        init.instruction(&Instruction::I32Const(4));
        init.instruction(&Instruction::I32Const(program.slots.len() as i32));
        init.instruction(&Instruction::I32Store(MemArg {
            offset: 0,
            align: 2,
            memory_index: 0,
        }));
        // clear continuation frame
        init.instruction(&Instruction::I32Const(CONT_OFFSET as i32));
        init.instruction(&Instruction::I32Const(0));
        init.instruction(&Instruction::I32Store(MemArg {
            offset: 0,
            align: 2,
            memory_index: 0,
        }));
        init.instruction(&Instruction::End);
        code.function(&init);
        exports.export("aether_init", ExportKind::Func, AETHER_INIT_FN);

        // aether_resume — same as apply_delta (CPS re-entry after effect)
        exports.export("aether_resume", ExportKind::Func, APPLY_DELTA_FN);

        let mut next_fn_index = AETHER_INIT_FN + 1;
        let mut emitted: HashMap<String, u32> = HashMap::new();
        let mut effect_ids: HashMap<String, i32> = HashMap::new();
        let mut next_effect_id = 1i32;

        let mut perform_names: Vec<_> = program
            .effects
            .iter()
            .filter_map(|(_, op)| match op {
                EffectOp::Perform { effect, .. } => Some(effect.clone()),
                _ => None,
            })
            .collect();
        perform_names.sort();
        perform_names.dedup();
        for name in &perform_names {
            effect_ids.insert(name.clone(), next_effect_id);
            next_effect_id += 1;
        }

        let mut effect_entries: Vec<_> = program.effects.iter().collect();
        effect_entries.sort_by(|a, b| a.0.cmp(b.0));

        for (name, op) in effect_entries {
            if emitted.contains_key(name) {
                continue;
            }
            match op {
                EffectOp::LocalMutate { slot, delta } => {
                    functions.function(2);
                    let mut f = Function::new(vec![]);
                    let offset = HEADER_SIZE + slot.0 * SLOT_I32_SIZE;
                    f.instruction(&Instruction::I32Const(slot.0 as i32));
                    f.instruction(&Instruction::I32Const(offset as i32));
                    f.instruction(&Instruction::I32Load(MemArg {
                        offset: 0,
                        align: 2,
                        memory_index: 0,
                    }));
                    f.instruction(&Instruction::I32Const(*delta));
                    f.instruction(&Instruction::I32Add);
                    f.instruction(&Instruction::Call(APPLY_DELTA_FN));
                    f.instruction(&Instruction::End);
                    code.function(&f);
                    exports.export(name, ExportKind::Func, next_fn_index);
                    emitted.insert(name.clone(), next_fn_index);
                    next_fn_index += 1;
                }
                EffectOp::ServerMutate { .. } => {
                    functions.function(2);
                    let mut f = Function::new(vec![]);
                    f.instruction(&Instruction::End);
                    code.function(&f);
                    exports.export(name, ExportKind::Func, next_fn_index);
                    emitted.insert(name.clone(), next_fn_index);
                    next_fn_index += 1;
                }
                EffectOp::Perform {
                    effect,
                    resume_slot,
                } => {
                    let eid = *effect_ids.get(effect).unwrap_or(&1);
                    functions.function(2);
                    let mut f = Function::new(vec![]);
                    // write continuation frame (suspend / "unwind" checkpoint)
                    f.instruction(&Instruction::I32Const(CONT_OFFSET as i32));
                    f.instruction(&Instruction::I32Const(CONT_STATUS_SUSPENDED as i32));
                    f.instruction(&Instruction::I32Store(MemArg {
                        offset: 0,
                        align: 2,
                        memory_index: 0,
                    }));
                    f.instruction(&Instruction::I32Const((CONT_OFFSET + 4) as i32));
                    f.instruction(&Instruction::I32Const(eid));
                    f.instruction(&Instruction::I32Store(MemArg {
                        offset: 0,
                        align: 2,
                        memory_index: 0,
                    }));
                    f.instruction(&Instruction::I32Const((CONT_OFFSET + 8) as i32));
                    f.instruction(&Instruction::I32Const(resume_slot.0 as i32));
                    f.instruction(&Instruction::I32Store(MemArg {
                        offset: 0,
                        align: 2,
                        memory_index: 0,
                    }));
                    let offset = HEADER_SIZE + resume_slot.0 * SLOT_I32_SIZE;
                    f.instruction(&Instruction::I32Const((CONT_OFFSET + 12) as i32));
                    f.instruction(&Instruction::I32Const(offset as i32));
                    f.instruction(&Instruction::I32Load(MemArg {
                        offset: 0,
                        align: 2,
                        memory_index: 0,
                    }));
                    f.instruction(&Instruction::I32Store(MemArg {
                        offset: 0,
                        align: 2,
                        memory_index: 0,
                    }));

                    f.instruction(&Instruction::I32Const(eid));
                    f.instruction(&Instruction::I32Const(resume_slot.0 as i32));
                    f.instruction(&Instruction::I32Const(offset as i32));
                    f.instruction(&Instruction::I32Load(MemArg {
                        offset: 0,
                        align: 2,
                        memory_index: 0,
                    }));
                    f.instruction(&Instruction::Call(AETHER_SUSPEND));
                    f.instruction(&Instruction::End);
                    code.function(&f);
                    exports.export(name, ExportKind::Func, next_fn_index);
                    emitted.insert(name.clone(), next_fn_index);
                    next_fn_index += 1;
                }
            }
        }

        exports.export("memory", ExportKind::Memory, 0);

        self.module.section(&types);
        self.module.section(&imports);
        self.module.section(&functions);
        self.module.section(&memories);
        if with_gc {
            self.module.section(&globals);
        }
        self.module.section(&exports);
        self.module.section(&code);

        let model = if with_gc { "wasmgc" } else { "linear" };
        let meta = format!(
            "{{\"model\":\"{}\",\"slots\":{},\"effects\":{},\"cont_offset\":{}}}",
            model,
            program.slots.len(),
            effect_ids.len(),
            CONT_OFFSET
        );
        self.module.section(&CustomSection {
            name: "aether-gc".into(),
            data: meta.into_bytes().into(),
        });

        if !effect_ids.is_empty() {
            let mut table = String::new();
            let mut pairs: Vec<_> = effect_ids.iter().collect();
            pairs.sort_by_key(|(_, id)| *id);
            for (name, id) in pairs {
                table.push_str(&format!("{}={}\n", id, name));
            }
            self.module.section(&CustomSection {
                name: "aether-effects".into(),
                data: table.into_bytes().into(),
            });
        }

        self.module.clone().finish()
    }
}

impl Default for WasmGenerator {
    fn default() -> Self {
        Self::new()
    }
}
