import { html } from "lit";

export const template = html`
  <div>
    <h1>${count}</h1>
    <button @click=${inc_count}>+</button>
    <ul>
      ${items.map((item) => (<li class="row">row</li>))}
    </ul>
  </div>
`;
