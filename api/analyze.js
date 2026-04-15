const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");

function sendJson(res, statusCode, data) {
  res.status(statusCode).json(data);
}

function getBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return null;
    }
  }
  if (typeof req.body === "object") return req.body;
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method_not_allowed", message: "Only POST is supported." });
  }

  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) {
    return sendJson(res, 500, {
      error: "missing_server_api_key",
      message: "Server env DEEPSEEK_API_KEY is not configured.",
    });
  }

  const body = getBody(req);
  if (!body) {
    return sendJson(res, 400, { error: "invalid_json", message: "Request body must be valid JSON." });
  }

  const userText = String(body.userText || "").trim();
  const systemPrompt = String(body.systemPrompt || "").trim();
  if (!userText || !systemPrompt) {
    return sendJson(res, 400, { error: "missing_input", message: "userText and systemPrompt are required." });
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
    } catch (e) {
      data = {};
    }

    if (!upstream.ok) {
      return sendJson(res, 502, { error: "upstream_error", details: data || rawText.slice(0, 600) });
    }
    if (!data || !Array.isArray(data.choices)) {
      return sendJson(res, 502, {
        error: "invalid_upstream_payload",
        details: typeof rawText === "string" ? rawText.slice(0, 600) : "",
      });
    }

    return sendJson(res, 200, data);
  } catch (err) {
    return sendJson(res, 500, { error: "proxy_request_failed", message: "Failed to call DeepSeek." });
  }
};
