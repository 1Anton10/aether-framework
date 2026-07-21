export default function App() {
  return (
    <div>
      <h1>{count}</h1>
      <p>doubled: {doubled}</p>
      <p>remote: {remote}</p>
      <button onClick={inc_count}>+</button>
      <button onClick={server_inc_count}>+ server</button>
      <button onClick={load_remote}>effect db.get</button>
      <p>
        <a href="/">Aether home</a>
      </p>
    </div>
  );
}
