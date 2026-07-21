export default function HomePage() {
  return (
    <div>
      <h1>Pages: home</h1>
      <p>count: {count}</p>
      <button onClick={inc_count}>+</button>
      <p>
        <a href="/about">About →</a>
      </p>
    </div>
  );
}
