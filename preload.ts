// Preload shim: tronweb (Google protobuf closure lib) expects a global `proto`
// namespace object, but Bun doesn't provide it. This runs before any imports.
(globalThis as any).proto = {};
