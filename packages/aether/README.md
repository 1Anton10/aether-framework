# aether-std

Meta package for the **Aether Frontend Runtime Standard** (`aether` on npm is already taken by an unrelated project).

```bash
npm i aether-std
```

```js
import { renderToString } from "aether-std/ssr";
import { createRouter } from "aether-std/router";
import { defineStore } from "aether-std/store";
```

CLI (from monorepo):

```bash
npm run create -- my-app
npm run start
```

Or after publish:

```bash
npm create aether@latest my-app
```

See `/demo` for the live capability tour.
