(function () {
  if (window.__dreeFunnelTracker) return;
  window.__dreeFunnelTracker = true;

  var endpoint = '/api/metrics/event';
  var storageKey = 'dree_visitor_id';
  var sessionKey = 'dree_session_id';
  var openedAt = Date.now();
  var exitSent = false;

  function uuid(prefix) {
    var random = Math.random().toString(36).slice(2, 10);
    return prefix + '_' + Date.now().toString(36) + '_' + random;
  }

  function readStorage(storage, key) {
    try { return storage.getItem(key); } catch (_error) { return ''; }
  }

  function writeStorage(storage, key, value) {
    try { storage.setItem(key, value); } catch (_error) {}
  }

  function visitorId() {
    var id = readStorage(window.localStorage, storageKey);
    if (!id) {
      id = uuid('visitor');
      writeStorage(window.localStorage, storageKey, id);
    }
    return id;
  }

  function sessionId() {
    var id = readStorage(window.sessionStorage, sessionKey);
    if (!id) {
      id = uuid('session');
      writeStorage(window.sessionStorage, sessionKey, id);
    }
    return id;
  }

  function inferStep() {
    var path = window.location.pathname;
    if (path.indexOf('etapa-3') !== -1) return 'checkout';
    if (path.indexOf('etapa-2') !== -1) return 'etapa_2';
    return 'home';
  }

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name) || ''; } catch (_error) { return ''; }
  }

  function currentStep() {
    return (window.DREE_FUNNEL && window.DREE_FUNNEL.step) || inferStep();
  }

  function payload(type, data) {
    return {
      type: type,
      step: currentStep(),
      sessionId: sessionId(),
      visitorId: visitorId(),
      path: window.location.pathname + window.location.search,
      referrer: document.referrer || '',
      source: queryParam('utm_source') || queryParam('src'),
      campaign: queryParam('utm_campaign'),
      timestamp: new Date().toISOString(),
      data: data || {}
    };
  }

  function send(type, data, options) {
    var body = JSON.stringify(payload(type, data));
    if (options && options.beacon && navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      return;
    }

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: Boolean(options && options.keepalive)
    }).catch(function () {});
  }

  function sendExit() {
    if (exitSent) return;
    exitSent = true;
    var event = payload('step_exit', {});
    event.durationMs = Date.now() - openedAt;
    var body = JSON.stringify(event);

    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      return;
    }

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true
    }).catch(function () {});
  }

  window.DreeMetrics = {
    track: send,
    step: currentStep,
    setStep: function (step) {
      window.DREE_FUNNEL = window.DREE_FUNNEL || {};
      window.DREE_FUNNEL.step = step;
    },
    identify: function () {
      return {
        sessionId: sessionId(),
        visitorId: visitorId(),
        step: currentStep()
      };
    },
    flush: sendExit
  };

  send('step_view', {
    title: document.title,
    width: window.innerWidth,
    height: window.innerHeight
  });

  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (link) {
      var href = link.getAttribute('href') || '';
      if (href.indexOf('etapa-2') !== -1 || href.indexOf('etapa-3') !== -1) {
        send('cta_click', {
          text: (link.textContent || '').trim().slice(0, 120),
          href: href
        }, { keepalive: true });
      }
    }
  });

  document.addEventListener('play', function (event) {
    if (event.target && event.target.tagName === 'VIDEO') {
      send('video_play', {
        src: event.target.currentSrc || event.target.getAttribute('src') || ''
      });
    }
  }, true);

  document.addEventListener('input', function (event) {
    var form = event.target && event.target.closest && event.target.closest('form');
    if (!form || form.__dreeFormStarted) return;
    form.__dreeFormStarted = true;
    send('form_start', {
      form: form.id || form.getAttribute('name') || 'checkout'
    });
  }, true);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendExit();
  });

  window.addEventListener('pagehide', sendExit);
})();
