import { createSignal } from "solid-js";

export default function App() {
  return (
    <div>
      <h1>{count()}</h1>
      <button onClick={inc_count}>+</button>
    </div>
  );
}
