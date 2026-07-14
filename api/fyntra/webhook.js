const { normalizeOrder, validateOrder, sendOrderToTrack7 } = require('../_lib/track7');
const { appendEvent } = require('../_lib/metrics-store');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function isPaid(status) {
  return String(status || '').toLowerCase().indexOf('paid') !== -1;
}

function parseMetadata(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

async function forwardToTrack7IfPaid(payload) {
  const data = (payload && payload.data) || payload || {};
  if (!isPaid(data.status)) return;

  const metadata = parseMetadata(data.metadata);
  const tracking = metadata && metadata.tracking;
  if (tracking && tracking.sessionId && tracking.visitorId) {
    try {
      await appendEvent({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        type: 'payment_approved',
        step: 'paid',
        sessionId: String(tracking.sessionId).slice(0, 96),
        visitorId: String(tracking.visitorId).slice(0, 96),
        path: 'webhook:fyntra',
        referrer: '',
        source: 'webhook',
        campaign: '',
        durationMs: 0,
        timestamp: new Date().toISOString(),
        data: {
          transactionId: data.id || '',
          orderNumber: metadata.order_number || '',
          amount: Number(data.amount || 0)
        },
        ua: 'fyntra-webhook',
        ip: ''
      });
    } catch (error) {
      console.error('Metrics webhook: falha ao registrar pagamento.', error instanceof Error ? error.message : error);
    }
  }

  const logisticsOrder = metadata && metadata.logistics_order;
  if (!logisticsOrder) return;

  const order = normalizeOrder(logisticsOrder);
  const { valid, errors } = validateOrder(order);
  if (!valid) {
    console.error('Track7 webhook: pedido invalido, nao enviado.', errors);
    return;
  }

  await sendOrderToTrack7({ ...order, transactionId: data.id || order.transactionId || null });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  console.log('Fyntra webhook received', JSON.stringify(req.body || {}));

  try {
    await forwardToTrack7IfPaid(req.body || {});
  } catch (error) {
    console.error('Track7 webhook: falha ao enviar pedido.', error instanceof Error ? error.message : error);
  }

  // Sempre responde 200 para nao travar retries do gateway de pagamento.
  return json(res, 200, { received: true });
};
