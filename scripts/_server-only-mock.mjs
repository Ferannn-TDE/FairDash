// Test substitute for the `server-only` marker (see _route-loader.mjs). The real package throws
// when imported outside Next's react-server condition, which is every script. The marker only
// exists to fail a CLIENT bundle; the build still enforces it. Nothing to export.
export {}
