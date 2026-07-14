const DEFAULT_BASE_URL = 'https://track7.app/api/v1';

const UF_LIST = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpf(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  const checkDigit = (base) => {
    let sum = 0;
    let weight = base.length + 1;
    for (const digit of base) {
      sum += Number(digit) * weight;
      weight -= 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const d1 = checkDigit(digits.slice(0, 9));
  const d2 = checkDigit(digits.slice(0, 9) + d1);
  return digits === digits.slice(0, 9) + String(d1) + String(d2);
}

function isValidCnpj(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;

  const checkDigit = (base) => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base.length; i += 1) {
      sum += Number(base[i]) * weights[i];
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const d1 = checkDigit(digits.slice(0, 12));
  const d2 = checkDigit(digits.slice(0, 12) + d1);
  return digits === digits.slice(0, 12) + String(d1) + String(d2);
}

function isValidDocument(value) {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isValidPhone(value) {
  const digits = onlyDigits(value);
  return digits.length === 10 || digits.length === 11;
}

function isValidUf(value) {
  return UF_LIST.includes(String(value || '').trim().toUpperCase());
}

function isValidZipCode(value) {
  return onlyDigits(value).length === 8;
}

function centsToAmount(cents) {
  return Math.round(Number(cents)) / 100;
}

/**
 * Aceita tanto o formato de transacao da Fyntra (customer/items/amount, com
 * document como {number,type} e valores em centavos) quanto um formato ja
 * simplificado (customer/products/total, valores em reais).
 */
function normalizeOrder(rawOrder) {
  const raw = rawOrder || {};
  const rawCustomer = raw.customer || {};
  const rawAddress = rawCustomer.address || raw.address || {};
  const rawProducts = Array.isArray(raw.products) ? raw.products
    : Array.isArray(raw.items) ? raw.items
    : [];

  const documentValue = rawCustomer.document && typeof rawCustomer.document === 'object'
    ? rawCustomer.document.number
    : rawCustomer.document;

  const products = rawProducts.map((item) => {
    const price = item.price != null ? Number(item.price) : centsToAmount(item.unitPrice);
    const quantity = Number.isInteger(item.quantity) ? item.quantity : Number(item.quantity);
    return {
      name: String(item.name || item.title || '').trim(),
      price: Number.isFinite(price) ? Number(price.toFixed(2)) : NaN,
      quantity: Number.isFinite(quantity) ? quantity : NaN
    };
  });

  const computedTotal = products.reduce((sum, p) => {
    return sum + (Number.isFinite(p.price) && Number.isFinite(p.quantity) ? p.price * p.quantity : 0);
  }, 0);

  const total = raw.total != null
    ? Number(raw.total)
    : (raw.amount != null ? centsToAmount(raw.amount) : computedTotal);

  return {
    transactionId: raw.transactionId || raw.id || null,
    customer: {
      name: String(rawCustomer.name || '').trim(),
      email: String(rawCustomer.email || '').trim().toLowerCase(),
      phone: onlyDigits(rawCustomer.phone),
      document: onlyDigits(documentValue),
      address: {
        street: String(rawAddress.street || '').trim(),
        number: String(rawAddress.streetNumber || rawAddress.number || '').trim(),
        complement: String(rawAddress.complement || '').trim(),
        neighborhood: String(rawAddress.neighborhood || '').trim(),
        city: String(rawAddress.city || '').trim(),
        state: String(rawAddress.state || '').trim().toUpperCase(),
        zipCode: onlyDigits(rawAddress.zipCode)
      }
    },
    products,
    total: Number(Number(total).toFixed(2))
  };
}

function validateOrder(order) {
  const errors = [];
  const customer = (order && order.customer) || {};
  const address = customer.address || {};

  if (!customer.name) errors.push('Nome do cliente e obrigatorio.');
  if (!isValidEmail(customer.email)) errors.push('Email invalido.');
  if (!isValidPhone(customer.phone)) errors.push('Telefone invalido.');
  if (!isValidDocument(customer.document)) errors.push('CPF/CNPJ invalido.');

  if (!address.street) errors.push('Endereco (rua) e obrigatorio.');
  if (!address.number) errors.push('Numero do endereco e obrigatorio.');
  if (!address.neighborhood) errors.push('Bairro e obrigatorio.');
  if (!address.city) errors.push('Cidade e obrigatoria.');
  if (!isValidUf(address.state)) errors.push('UF invalida.');
  if (!isValidZipCode(address.zipCode)) errors.push('CEP invalido.');

  const products = Array.isArray(order && order.products) ? order.products : [];
  if (products.length === 0) {
    errors.push('Pedido sem produtos.');
  } else {
    products.forEach((product, index) => {
      if (!product.name) errors.push(`Produto ${index + 1}: nome e obrigatorio.`);
      if (!Number.isFinite(product.price) || product.price < 0) errors.push(`Produto ${index + 1}: preco invalido.`);
      if (!Number.isInteger(product.quantity) || product.quantity <= 0) errors.push(`Produto ${index + 1}: quantidade invalida.`);
    });

    const computedTotal = products.reduce((sum, p) => sum + (Number(p.price) * Number(p.quantity)), 0);
    if (Math.abs(computedTotal - Number(order.total)) > 0.01) {
      errors.push(`Total nao confere: informado R$ ${Number(order.total).toFixed(2)}, calculado R$ ${computedTotal.toFixed(2)}.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

async function sendOrderToTrack7(order) {
  const apiKey = process.env.TRACK7_API_KEY;
  if (!apiKey) {
    const error = new Error('TRACK7_API_KEY nao configurada no ambiente.');
    error.statusCode = 500;
    throw error;
  }

  const baseUrl = process.env.TRACK7_BASE_URL || DEFAULT_BASE_URL;

  const response = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(order)
  });

  const responseData = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      (responseData && responseData.message) || `Falha ao enviar pedido para o Track7 (HTTP ${response.status}).`
    );
    error.statusCode = response.status;
    error.details = responseData;
    throw error;
  }

  return responseData;
}

module.exports = {
  normalizeOrder,
  validateOrder,
  sendOrderToTrack7,
  isValidDocument,
  isValidEmail,
  isValidPhone,
  isValidUf,
  isValidZipCode
};
