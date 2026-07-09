// Cross-module callback registry, wired once at boot in app.js.
// Breaks import cycles: modules call bus.render() / bus.selectField()
// without importing app.js directly.
export const bus = {
  render: () => {},
  selectField: () => {},
  highlightEvidence: () => {},
  switchTab: () => {},
};
