// Roteador simples: sem dependências externas.
// Suporta parâmetros de rota (:id) e leitura de corpo JSON.

function matchRoute(routePath, reqPath) {
  const routeParts = routePath.split("/").filter(Boolean);
  const reqParts = reqPath.split("/").filter(Boolean);
  if (routeParts.length !== reqParts.length) return null;
  const params = {};
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(":")) {
      params[routeParts[i].slice(1)] = decodeURIComponent(reqParts[i]);
    } else if (routeParts[i] !== reqParts[i]) {
      return null;
    }
  }
  return params;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    const MAX = 15 * 1024 * 1024; // 15MB (dá margem para imagens em base64)
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error("Corpo da requisição muito grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("JSON inválido no corpo da requisição"));
      }
    });
    req.on("error", reject);
  });
}

class Router {
  constructor() {
    this.routes = [];
  }
  add(method, path, ...handlers) {
    this.routes.push({ method, path, handlers });
  }
  get(path, ...h) { this.add("GET", path, ...h); }
  post(path, ...h) { this.add("POST", path, ...h); }
  put(path, ...h) { this.add("PUT", path, ...h); }
  delete(path, ...h) { this.add("DELETE", path, ...h); }

  async handle(req, res, url) {
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = matchRoute(route.path, url.pathname);
      if (!params) continue;
      req.params = params;
      req.query = Object.fromEntries(url.searchParams);
      if (["POST", "PUT", "PATCH"].includes(req.method)) {
        try {
          req.body = await readBody(req);
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
          return true;
        }
      }
      try {
        for (const handler of route.handlers) {
          let shortCircuited = false;
          await handler(req, res, () => { shortCircuited = true; });
          if (res.writableEnded) return true;
          if (!shortCircuited) break;
        }
      } catch (e) {
        console.error(e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Erro interno do servidor" }));
      }
      return true;
    }
    return false;
  }
}

module.exports = { Router, readBody };
