/** Angular-shaped shim — templates compile via Angular HTML parser. */
export function Component(_opts) {
  return function (cls) {
    return cls;
  };
}
export function Injectable() {
  return function (cls) {
    return cls;
  };
}
export default { Component, Injectable };
