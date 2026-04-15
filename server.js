const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");

/** 优先使用环境变量 DEEPSEEK_API_KEY（如 Vercel 后台配置）；仅当未设置时才使用请求体中的临时密钥（本地预览）。 */
function resolveDeepseekApiKey(body) {
  const envKey = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (envKey) return envKey;
  const fromBody = body && typeof body.deepseekApiKey === "string" ? body.deepseekApiKey.trim() : "";
  return fromBody;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("body_too_large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function handleAIProxy(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, { error: "invalid_json" });
  }

  const apiKey = resolveDeepseekApiKey(body);
  if (!apiKey) {
    return sendJson(res, 503, {
      error: "missing_api_key",
      message:
        "未配置 DEEPSEEK_API_KEY。请在部署环境（如 Vercel）设置该环境变量；本地预览可在页面底部填写临时密钥（仅当服务端未配置时由浏览器传入）。",
    });
  }

  const userText = String(body.userText || "").trim();
  const systemPrompt = String(body.systemPrompt || "").trim();
  if (!userText || !systemPrompt) {
    return sendJson(res, 400, { error: "missing_input", message: "userText 和 systemPrompt 必填" });
  }

  try {
    const upstream = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
      }),
    });

    const rawText = await upstream.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (err) {
      data = {};
    }
    if (!upstream.ok) {
      return sendJson(res, 502, { error: "upstream_error", details: data });
    }
    if (!data || !Array.isArray(data.choices)) {
      return sendJson(res, 502, {
        error: "invalid_upstream_payload",
        details: rawText.slice(0, 600),
      });
    }
    return sendJson(res, 200, data);
  } catch (err) {
    return sendJson(res, 500, { error: "proxy_request_failed" });
  }
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "text/plain; charset=utf-8";
}

function serveStaticFile(res, fileName) {
  const safeName = path.basename(fileName || "");
  const filePath = path.join(__dirname, safeName);
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": getMimeType(filePath) });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && (url.pathname === "/api/ai-analysis" || url.pathname === "/api/analyze")) {
    handleAIProxy(req, res);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    serveStaticFile(res, "index.html");
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin.html") {
    serveStaticFile(res, "admin.html");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`MindPlatform running at http://localhost:${PORT}`);
});

