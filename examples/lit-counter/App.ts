import { html } from "lit";

export const template = html`
  <div>
    <h1>${count}</h1>
    <button @click=${inc_count}>+</button>
  </div>
`;
