const { appendEvent } = require('../_lib/metrics-store');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }
  return req.body || {};
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item) || item === null)
      .map(([key, item]) => [cleanText(key, 48), typeof item === 'string' ? cleanText(item, 300) : item])
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  let payload;
  try {
    payload = readBody(req);
  } catch (_error) {
    return json(res, 400, { message: 'Body JSON invalido.' });
  }

  const event = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    type: cleanText(payload.type, 64) || 'event',
    step: cleanText(payload.step, 32),
    sessionId: cleanText(payload.sessionId, 96),
    visitorId: cleanText(payload.visitorId, 96),
    path: cleanText(payload.path, 220),
    referrer: cleanText(payload.referrer, 300),
    source: cleanText(payload.source, 120),
    campaign: cleanText(payload.campaign, 120),
    durationMs: Math.max(0, Math.min(Number(payload.durationMs || 0), 1000 * 60 * 60 * 6)),
    timestamp: payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString(),
    data: cleanObject(payload.data),
    ua: cleanText(req.headers['user-agent'], 300),
    ip: cleanText(req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress, 120)
  };

  if (!event.sessionId || !event.visitorId) {
    return json(res, 400, { message: 'Evento sem sessionId ou visitorId.' });
  }

  try {
    const result = await appendEvent(event);
    return json(res, 200, { ok: true, driver: result.driver });
  } catch (error) {
    return json(res, 500, {
      message: 'Nao foi possivel salvar o evento.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
