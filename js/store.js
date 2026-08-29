// Minimal pub/sub state store.
// `set` diffs the patch and hands changed keys to listeners so subscribers can
// react selectively — without that, a listener that writes state on any change
// (e.g. the list pane setting `loading`) would re-enter itself forever.
const listeners = new Set();

export const store = {
  state: {
    view: 'INBOX',
    selectedId: null,
    query: '',
    counts: {},
    loading: false,
    error: null,
    activity: [],
    profile: null,
  },

  set(patch) {
    const changed = Object.keys(patch).filter(k => !Object.is(this.state[k], patch[k]));
    if (!changed.length) return;
    this.state = { ...this.state, ...patch };
    listeners.forEach(fn => fn(this.state, changed));
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  logActivity(type, detail) {
    const entry = { type, detail, at: new Date().toISOString() };
    this.set({ activity: [entry, ...this.state.activity].slice(0, 100) });
  },
};
