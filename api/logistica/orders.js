const { normalizeOrder, validateOrder, sendOrderToTrack7 } = require('../_lib/track7');
const { getFyntraTransaction, isPaid } = require('../_lib/fyntra');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  let payload;
  try {
    payload = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});
  } catch (_error) {
    return json(res, 400, { message: 'Body JSON invalido.' });
  }

  const transactionId = String(payload.transactionId || '').trim();
  if (!transactionId) {
    return json(res, 400, { message: 'Informe o transactionId do pagamento.' });
  }

  const order = normalizeOrder(payload);
  const { valid, errors } = validateOrder(order);
  if (!valid) {
    return json(res, 422, { message: 'Pedido invalido.', errors });
  }

  try {
    const transaction = await getFyntraTransaction(transactionId);
    if (!isPaid(transaction)) {
      return json(res, 409, { message: 'Pagamento ainda nao aprovado para esta transacao.' });
    }
  } catch (error) {
    return json(res, error.statusCode || 502, {
      message: error.message || 'Falha ao confirmar pagamento na Fyntra.'
    });
  }

  try {
    const track7Response = await sendOrderToTrack7({ ...order, transactionId });
    return json(res, 200, { message: 'Pedido enviado ao Track7 com sucesso.', track7: track7Response });
  } catch (error) {
    return json(res, error.statusCode || 502, {
      message: error.message || 'Falha ao enviar pedido ao Track7.',
      details: error.details || null
    });
  }
};
