const store = { invites: [], guests: [] };

const db = {
  get(key) {
    return {
      value() {
        return store[key] || [];
      },
      find(query) {
        const col = store[key] || [];
        return {
          value() {
            if (typeof query === 'object') {
              return col.find(item => Object.entries(query).every(([k, v]) => item[k] === v));
            }
            return col.find(query);
          },
          assign(updates) {
            if (typeof query === 'object') {
              const idx = col.findIndex(item => Object.entries(query).every(([k, v]) => item[k] === v));
              if (idx !== -1) Object.assign(col[idx], updates);
            }
            return { write() { /* no-op */ } };
          },
          write() { /* no-op */ }
        };
      },
      filter(fn) {
        return {
          value() { return col.filter(fn); },
          slice(n) { return col.filter(fn).slice(0, n); }
        };
      },
      push(item) {
        col.push(item);
        return { write() { /* no-op */ } };
      },
      write() { /* no-op */ }
    };
  },
  set(key, value) {
    store[key] = value;
    return { write() { /* no-op */ } };
  },
  defaults(obj) {
    for (const [k, v] of Object.entries(obj)) {
      if (!store[k]) store[k] = [...v];
    }
    return { write() { /* no-op */ } };
  }
};

db.defaults({ invites: [], guests: [] }).write();

module.exports = db;
