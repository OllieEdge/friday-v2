function compilePattern(pattern) {
  const names = [];
  const parts = pattern
    .split("/")
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith(":")) {
        names.push(p.slice(1));
        return "([^/]+)";
      }
      return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
  const re = new RegExp(`^/${parts.join("/")}$`);
  return { re, names };
}

function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const { re, names } = compilePattern(pattern);
    routes.push({ method: method.toUpperCase(), re, names, handler });
  }

  async function handle(req, res, url) {
    const method = String(req.method || "GET").toUpperCase();
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = {};
      for (let i = 0; i < r.names.length; i++) params[r.names[i]] = m[i + 1];
      return r.handler(req, res, url, params);
    }
    return false;
  }

  return { add, handle };
}

module.exports = { createRouter };

