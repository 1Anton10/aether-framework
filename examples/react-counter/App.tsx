export default function App() {
  return (
    <div>
      <h1>{count}</h1>
      <button onClick={inc_count}>+</button>
      <ul>
        {items.map((item) => (
          <li className="row">row</li>
        ))}
      </ul>
    </div>
  );
}
