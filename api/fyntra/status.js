const DEFAULT_BASE_URL = 'https://api-gateway.fyntrabr.com';
const DEFAULT_USER_AGENT = 'AtivoB2B/1.0';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function normalizeExpiresAt(data) {
  const pix = data && data.pix ? data.pix : null;
  const rawExpiration = pix && pix.expirationDate ? new Date(pix.expirationDate) : null;
  if (rawExpiration && !Number.isNaN(rawExpiration.getTime()) && rawExpiration.getUTCFullYear() >= 2000) {
    return rawExpiration.toISOString();
  }

  const expiresInDays = pix && Number.isFinite(Number(pix.expiresInDays))
    ? Number(pix.expiresInDays)
    : (data && data.payload && data.payload.data && data.payload.data.pix && Number.isFinite(Number(data.payload.data.pix.expiresInDays))
      ? Number(data.payload.data.pix.expiresInDays)
      : null);

  const baseDate = data && data.createdAt ? new Date(data.createdAt) : new Date();
  if (expiresInDays && !Number.isNaN(baseDate.getTime())) {
    return new Date(baseDate.getTime() + (expiresInDays * 24 * 60 * 60 * 1000)).toISOString();
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  const apiKey = process.env.FYNTRA_API_KEY || process.env.CENTURION_API_KEY;
  if (!apiKey) {
    return json(res, 500, {
      message: 'FYNTRA_API_KEY nao configurada no ambiente.'
    });
  }

  const id = String((req.query && req.query.id) || '').trim();
  if (!id) {
    return json(res, 400, { message: 'Informe o id da transacao.' });
  }

  try {
    const upstream = await fetch(`${process.env.FYNTRA_API_BASE || DEFAULT_BASE_URL}/api/user/transactions/${encodeURIComponent(id)}`, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'x-api-key': apiKey
      }
    });

    const responseData = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return json(res, upstream.status, {
        message: responseData && responseData.message ? responseData.message : 'Nao foi possivel consultar a transacao.',
        details: responseData || null
      });
    }

    const data = responseData && responseData.data ? responseData.data : null;

    return json(res, 200, {
      id: data && data.id ? data.id : id,
      status: data && data.status ? data.status : null,
      paidAt: data && data.paidAt ? data.paidAt : null,
      pixCode: data && data.pix ? data.pix.qrcode || null : null,
      expiresAt: normalizeExpiresAt(data),
      raw: data || responseData
    });
  } catch (error) {
    return json(res, 502, {
      message: 'Falha ao consultar a transacao na Fyntra.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
