const DEFAULT_BASE_URL = 'https://api-gateway.fyntrabr.com';
const DEFAULT_USER_AGENT = 'AtivoB2B/1.0';
const BASE_AMOUNT_CENTS = 3700;
const ORDER_BUMP_CENTS = 1290;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatCpf(value) {
  const digits = onlyDigits(value).slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function formatPhone(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }

  return digits
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}

function formatZipCode(value) {
  const digits = onlyDigits(value).slice(0, 8);
  return digits.replace(/(\d{5})(\d)/, '$1-$2');
}

function parseRefusedReason(details) {
  const refusedReason = details && details.error ? details.error.refusedReason : null;
  if (!refusedReason) return null;

  if (typeof refusedReason === 'object') {
    return refusedReason;
  }

  try {
    return JSON.parse(refusedReason);
  } catch (_error) {
    return { message: String(refusedReason) };
  }
}

function buildUpstreamError(responseData) {
  const parsedReason = parseRefusedReason(responseData);
  const message = responseData && responseData.message
    ? responseData.message
    : 'Nao foi possivel gerar o PIX na Fyntra.';

  const fieldErrors = parsedReason && parsedReason.errors ? parsedReason.errors : null;
  const firstField = fieldErrors ? Object.keys(fieldErrors)[0] : null;
  const firstFieldMessage = firstField && Array.isArray(fieldErrors[firstField]) ? fieldErrors[firstField][0] : null;

  return {
    message: firstFieldMessage || (parsedReason && parsedReason.message) || message,
    details: responseData || null
  };
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

function buildOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return host ? `${proto}://${host}` : '';
}

function buildOrderNumber() {
  return `DREE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  const apiKey = process.env.FYNTRA_API_KEY || process.env.CENTURION_API_KEY;
  if (!apiKey) {
    return json(res, 500, {
      message: 'FYNTRA_API_KEY nao configurada no ambiente.'
    });
  }

  let payload;
  try {
    payload = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});
  } catch (_error) {
    return json(res, 400, { message: 'Body JSON invalido.' });
  }

  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const phone = onlyDigits(payload.phone);
  const document = onlyDigits(payload.document);
  const orderBump = Boolean(payload.orderBump);
  const amount = BASE_AMOUNT_CENTS + (orderBump ? ORDER_BUMP_CENTS : 0);
  const address = payload.address || {};
  const tracking = payload.tracking && typeof payload.tracking === 'object' ? payload.tracking : {};

  if (!name || !email || phone.length < 10 || document.length !== 11) {
    return json(res, 400, { message: 'Preencha nome, email, WhatsApp e CPF corretamente.' });
  }

  if (!address.street || !address.number || !address.zipCode || !address.neighborhood || !address.city || !address.state) {
    return json(res, 400, { message: 'Preencha o endereco completo para gerar o PIX.' });
  }

  const orderNumber = buildOrderNumber();
  const origin = buildOrigin(req);
  const postbackUrl = process.env.FYNTRA_POSTBACK_URL || process.env.CENTURION_POSTBACK_URL || (origin ? `${origin}/api/fyntra/webhook` : undefined);
  const baseUrl = process.env.FYNTRA_API_BASE || DEFAULT_BASE_URL;

  const transactionPayload = {
    amount,
    paymentMethod: 'PIX',
    customer: {
      name,
      email,
      phone: formatPhone(phone),
      externalRef: orderNumber,
      document: {
        number: formatCpf(document),
        type: 'CPF'
      },
      address: {
        street: String(address.street).trim(),
        streetNumber: String(address.number).trim(),
        complement: String(address.complement || '').trim(),
        zipCode: formatZipCode(address.zipCode),
        neighborhood: String(address.neighborhood).trim(),
        city: String(address.city).trim(),
        state: String(address.state).trim().toUpperCase(),
        country: 'BR'
      }
    },
    shipping: {
      fee: 0,
      address: {
        street: String(address.street).trim(),
        streetNumber: String(address.number).trim(),
        complement: String(address.complement || '').trim(),
        zipCode: formatZipCode(address.zipCode),
        neighborhood: String(address.neighborhood).trim(),
        city: String(address.city).trim(),
        state: String(address.state).trim().toUpperCase(),
        country: 'BR'
      }
    },
    items: [
      {
        title: 'Frete e ativacao do Kit Loja de 10',
        unitPrice: amount - (orderBump ? ORDER_BUMP_CENTS : 0),
        quantity: 1,
        tangible: true,
        externalRef: 'dree-frete-ativacao'
      },
      ...(orderBump ? [{
        title: 'Embalagem rosa da marca',
        unitPrice: ORDER_BUMP_CENTS,
        quantity: 1,
        tangible: true,
        externalRef: 'dree-order-bump'
      }] : [])
    ],
    pix: {
      expiresInDays: 1
    },
    metadata: JSON.stringify({
      order_number: orderNumber,
      source: 'checkout-dree',
      bump: orderBump,
      tracking: {
        sessionId: String(tracking.sessionId || '').slice(0, 96),
        visitorId: String(tracking.visitorId || '').slice(0, 96),
        step: String(tracking.step || 'checkout').slice(0, 32)
      },
      logistics_order: {
        customer: {
          name,
          email,
          phone: formatPhone(phone),
          document: formatCpf(document),
          address: {
            street: String(address.street).trim(),
            number: String(address.number).trim(),
            complement: String(address.complement || '').trim(),
            neighborhood: String(address.neighborhood).trim(),
            city: String(address.city).trim(),
            state: String(address.state).trim().toUpperCase(),
            zipCode: formatZipCode(address.zipCode)
          }
        },
        products: [
          {
            name: 'Frete e ativacao do Kit Loja de 10',
            price: (amount - (orderBump ? ORDER_BUMP_CENTS : 0)) / 100,
            quantity: 1
          },
          ...(orderBump ? [{
            name: 'Embalagem rosa da marca',
            price: ORDER_BUMP_CENTS / 100,
            quantity: 1
          }] : [])
        ],
        total: amount / 100
      }
    })
  };

  if (postbackUrl) {
    transactionPayload.postbackUrl = postbackUrl;
  }

  try {
    const upstream = await fetch(`${baseUrl}/api/user/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DEFAULT_USER_AGENT,
        'x-api-key': apiKey
      },
      body: JSON.stringify(transactionPayload)
    });

    const responseData = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return json(res, upstream.status, buildUpstreamError(responseData));
    }

    const data = responseData && responseData.data ? responseData.data : null;
    const pix = data && data.pix ? data.pix : {};
    const pixCode = pix.qrcode || data.qrCode || null;

    return json(res, 200, {
      transactionId: data && data.id ? data.id : null,
      status: data && data.status ? data.status : null,
      amount: data && Number.isFinite(data.amount) ? data.amount : amount,
      orderNumber,
      pixCode,
      expiresAt: normalizeExpiresAt(data),
      raw: data || responseData
    });
  } catch (error) {
    return json(res, 502, {
      message: 'Falha ao comunicar com a Fyntra.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
