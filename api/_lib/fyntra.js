const DEFAULT_BASE_URL = 'https://api-gateway.fyntrabr.com';
const DEFAULT_USER_AGENT = 'AtivoB2B/1.0';

async function getFyntraTransaction(transactionId) {
  const apiKey = process.env.FYNTRA_API_KEY || process.env.CENTURION_API_KEY;
  if (!apiKey) {
    const error = new Error('FYNTRA_API_KEY nao configurada no ambiente.');
    error.statusCode = 500;
    throw error;
  }

  const baseUrl = process.env.FYNTRA_API_BASE || DEFAULT_BASE_URL;
  const response = await fetch(`${baseUrl}/api/user/transactions/${encodeURIComponent(transactionId)}`, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'x-api-key': apiKey
    }
  });

  const responseData = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      (responseData && responseData.message) || 'Nao foi possivel consultar a transacao na Fyntra.'
    );
    error.statusCode = response.status;
    throw error;
  }

  return responseData && responseData.data ? responseData.data : null;
}

function isPaid(transaction) {
  const status = String((transaction && transaction.status) || '').toLowerCase();
  return status.indexOf('paid') !== -1;
}

module.exports = { getFyntraTransaction, isPaid };
