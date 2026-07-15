const { readEvents, hasPersistentStore } = require('../_lib/metrics-store');

const STAGES = [
  { id: 'home', label: 'Pagina inicial' },
  { id: 'etapa_2', label: 'Etapa 2' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'pix', label: 'Pix gerado' },
  { id: 'paid', label: 'Pago' }
];

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function checkAccess(req) {
  const expected = process.env.DREE_DASHBOARD_KEY || process.env.DASHBOARD_KEY || '';
  if (!expected) return true;

  const provided = String(
    req.headers['x-dashboard-key'] ||
    (req.query && req.query.key) ||
    ''
  );

  return provided === expected;
}

function stageFromEvent(event) {
  if (event.type === 'pix_generated') return 'pix';
  if (event.type === 'payment_approved' || event.type === 'purchase') return 'paid';
  if (event.step) return event.step;

  const path = String(event.path || '');
  if (path.includes('etapa-3')) return 'checkout';
  if (path.includes('etapa-2')) return 'etapa_2';
  return 'home';
}

function avg(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function toTimestamp(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function mergeLeadData(target, source) {
  if (!source || typeof source !== 'object') return target;
  const fields = [
    'name',
    'email',
    'phone',
    'cpfMasked',
    'zipCode',
    'city',
    'state',
    'orderBump',
    'amount',
    'filledFields',
    'completionPct'
  ];

  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null && source[field] !== '') {
      target[field] = source[field];
    }
  }

  return target;
}

function summarize(events) {
  const stageIndex = Object.fromEntries(STAGES.map((stage, index) => [stage.id, index]));
  const sessions = new Map();
  const stageSessions = Object.fromEntries(STAGES.map((stage) => [stage.id, new Set()]));
  const exits = Object.fromEntries(STAGES.map((stage) => [stage.id, 0]));
  const durations = Object.fromEntries(STAGES.map((stage) => [stage.id, []]));
  const durationKeys = new Set();
  const eventCounts = {};
  const leadProfiles = new Map();

  for (const event of events) {
    const sessionId = event.sessionId || 'sem-sessao';
    const stage = stageFromEvent(event);
    event.stage = stage;
    event.time = toTimestamp(event.timestamp);
    eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;

    if (!sessions.has(sessionId)) sessions.set(sessionId, []);
    sessions.get(sessionId).push(event);

    if (event.type === 'lead_update' || event.type === 'checkout_submit' || event.type === 'pix_generated' || event.type === 'payment_approved') {
      if (!leadProfiles.has(sessionId)) {
        leadProfiles.set(sessionId, {
          sessionId,
          visitorId: event.visitorId || '',
          name: '',
          email: '',
          phone: '',
          cpfMasked: '',
          zipCode: '',
          city: '',
          state: '',
          orderBump: false,
          amount: 0,
          filledFields: '',
          completionPct: 0,
          reached: stage,
          lastEvent: event.type,
          lastSeenAt: event.timestamp || '',
          source: event.source || ''
        });
      }

      const profile = leadProfiles.get(sessionId);
      profile.visitorId = event.visitorId || profile.visitorId;
      profile.lastEvent = event.type;
      profile.lastSeenAt = event.timestamp || profile.lastSeenAt;
      profile.source = event.source || profile.source;
      mergeLeadData(profile, event.data);
    }

    if (stageSessions[stage]) stageSessions[stage].add(sessionId);
    if (event.durationMs > 0 && durations[stage]) {
      durations[stage].push(event.durationMs);
      durationKeys.add(`${sessionId}:${stage}`);
    }
  }

  for (const [sessionId, rows] of sessions.entries()) {
    rows.sort((a, b) => a.time - b.time);
    let maxStage = 'home';

    for (let index = 0; index < rows.length; index += 1) {
      const current = rows[index];
      if ((stageIndex[current.stage] || 0) >= (stageIndex[maxStage] || 0)) {
        maxStage = current.stage;
      }

      const next = rows[index + 1];
      if (
        next &&
        current.stage !== next.stage &&
        durations[current.stage] &&
        !durationKeys.has(`${sessionId}:${current.stage}`)
      ) {
        const delta = next.time - current.time;
        if (delta > 0 && delta <= 1000 * 60 * 60 * 2) {
          durations[current.stage].push(delta);
          durationKeys.add(`${sessionId}:${current.stage}`);
        }
      }
    }

    if (exits[maxStage] !== undefined && maxStage !== 'paid') {
      exits[maxStage] += 1;
    }
  }

  const firstCount = stageSessions.home.size || 0;
  const rows = STAGES.map((stage, index) => {
    const count = stageSessions[stage.id].size;
    const previous = index === 0 ? count : stageSessions[STAGES[index - 1].id].size;
    const dropoff = Math.max(0, previous - count);

    return {
      id: stage.id,
      label: stage.label,
      count,
      fromStartPct: pct(count, firstCount),
      conversionFromPreviousPct: index === 0 ? 100 : pct(count, previous),
      dropoff,
      dropoffPct: index === 0 ? 0 : pct(dropoff, previous),
      exits: exits[stage.id],
      avgTimeMs: avg(durations[stage.id])
    };
  });

  const bottleneck = rows
    .slice(1)
    .sort((a, b) => b.dropoffPct - a.dropoffPct)[0] || null;
  const slowest = rows
    .filter((row) => row.avgTimeMs > 0)
    .sort((a, b) => b.avgTimeMs - a.avgTimeMs)[0] || null;

  const recentSessions = Array.from(sessions.entries())
    .map(([sessionId, rowsForSession]) => {
      const sorted = rowsForSession.sort((a, b) => a.time - b.time);
      const last = sorted[sorted.length - 1] || {};
      const reached = sorted.reduce((best, event) => {
        return (stageIndex[event.stage] || 0) >= (stageIndex[best] || 0) ? event.stage : best;
      }, 'home');

      return {
        sessionId,
        visitorId: last.visitorId || '',
        reached,
        lastEvent: last.type || '',
        lastSeenAt: last.timestamp || '',
        source: last.source || '',
        path: last.path || ''
      };
    })
    .sort((a, b) => toTimestamp(b.lastSeenAt) - toTimestamp(a.lastSeenAt))
    .slice(0, 30);

  const recentLeads = Array.from(leadProfiles.values())
    .map((lead) => {
      const rowsForSession = sessions.get(lead.sessionId) || [];
      const reached = rowsForSession.reduce((best, event) => {
        return (stageIndex[event.stage] || 0) >= (stageIndex[best] || 0) ? event.stage : best;
      }, 'checkout');

      return {
        ...lead,
        reached,
        hasContact: Boolean(lead.name || lead.email || lead.phone),
        location: [lead.city, lead.state].filter(Boolean).join(' / ') || lead.zipCode || ''
      };
    })
    .filter((lead) => lead.hasContact || Number(lead.completionPct || 0) > 0)
    .sort((a, b) => toTimestamp(b.lastSeenAt) - toTimestamp(a.lastSeenAt))
    .slice(0, 50);

  return {
    generatedAt: new Date().toISOString(),
    persistent: hasPersistentStore(),
    totals: {
      sessions: sessions.size,
      visitors: new Set(events.map((event) => event.visitorId).filter(Boolean)).size,
      events: events.length,
      paid: stageSessions.paid.size,
      conversionPct: pct(stageSessions.paid.size, firstCount)
    },
    stages: rows,
    bottleneck,
    slowest,
    eventCounts,
    recentLeads,
    recentSessions
  };
}

function isTestEvent(event) {
  return Boolean(
    event &&
    (
      String(event.sessionId || '').indexOf('test-') === 0 ||
      String(event.visitorId || '').indexOf('test-') === 0 ||
      (event.data && event.data.test)
    )
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  if (!checkAccess(req)) {
    return json(res, 401, { message: 'Chave do dashboard invalida.' });
  }

  const days = Math.max(1, Math.min(Number((req.query && req.query.days) || 7), 90));
  const limit = Math.max(500, Math.min(Number((req.query && req.query.limit) || 5000), 20000));
  const minTime = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    const events = (await readEvents(limit))
      .filter((event) => toTimestamp(event.timestamp) >= minTime)
      .filter((event) => !isTestEvent(event));

    return json(res, 200, {
      days,
      ...summarize(events)
    });
  } catch (error) {
    return json(res, 500, {
      message: 'Nao foi possivel gerar o resumo.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
