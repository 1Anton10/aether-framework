import fs from "fs";
import { execFileSync } from "child_process";

fs.writeFileSync(
  "target/map-bindings.json",
  JSON.stringify(
    { derived: [], handlers: { inc_items: { op: "inc", slot: "items", delta: 1 } } },
    null,
    2
  )
);
fs.writeFileSync(
  "target/map-test.tsx",
  `export default function App() {
  return (
    <ul>
      {items.map((item) => (
        <li className="row">row</li>
      ))}
    </ul>
  );
}
`
);

execFileSync(
  "target/debug/aether-compile.exe",
  ["--file", "target/map-test.tsx", ".", "target/map-out", "target/map-bindings.json"],
  { stdio: "inherit" }
);

const p = JSON.parse(fs.readFileSync("target/map-out/aether.program.json", "utf8"));
const loops = p.nodes.filter((n) => n.control_flow && n.control_flow.Loop);
console.log(
  JSON.stringify(
    {
      slots: p.slots.map((s) => s.name),
      loops: loops.map((n) => ({
        cf: n.control_flow,
        tag: n.node_type.Element && n.node_type.Element.tag,
      })),
    },
    null,
    2
  )
);
