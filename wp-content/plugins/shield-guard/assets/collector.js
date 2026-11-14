/**
 * Verius Invisible Client Telemetry Collector
 * Passively captures keystroke variance, mouse/touch movement, form completion timing, and webdriver.
 * Zero external requests; serializes payload directly into _shield_token on form submit.
 */
(function() {
  'use strict';

  function initCollector() {
    const forms = document.querySelectorAll('form#commentform, #review_form form, form.comment-form');
    if (!forms.length) return;

    forms.forEach(function(form) {
      if (form.dataset.shieldInitialized) return;
      form.dataset.shieldInitialized = 'true';

      const startTime = Date.now();
      let mouseMoves = 0;
      let touches = 0;
      let keyPressTimes = [];
      let lastKeyTime = 0;

      const decode = function(value) { return Uint8Array.from(atob(value), function(c) { return c.charCodeAt(0); }); };
      const encode = function(value) { return btoa(String.fromCharCode.apply(null, new Uint8Array(value))); };
      const publicKey = window.shieldMetricsConfig && window.shieldMetricsConfig.publicKey;
      const keyPromise = publicKey && window.crypto && window.crypto.subtle
        ? crypto.subtle.importKey('spki', decode(publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']).catch(function() { return null; })
        : Promise.resolve(null);
      let preparingSubmission = false;
      let replayingSubmission = false;

      // Inject hidden honeypot input (invisible to real users, irresistible to dumb bots)
      let hp = form.querySelector('input[name="_shield_hp_field"]');
      if (!hp) {
        hp = document.createElement('input');
        hp.type = 'text';
        hp.name = '_shield_hp_field';
        hp.value = '';
        hp.tabIndex = -1;
        hp.autocomplete = 'off';
        hp.style.position = 'absolute';
        hp.style.opacity = '0';
        hp.style.pointerEvents = 'none';
        hp.style.height = '0';
        hp.style.width = '0';
        hp.style.left = '-9999px';
        form.appendChild(hp);
      }

      // Inject hidden token input
      let tokenInput = form.querySelector('input[name="_shield_token"]');
      if (!tokenInput) {
        tokenInput = document.createElement('input');
        tokenInput.type = 'hidden';
        tokenInput.name = '_shield_token';
        form.appendChild(tokenInput);
      }

      // Passive interaction listeners
      window.addEventListener('mousemove', function() { mouseMoves++; }, { passive: true, once: false });
      window.addEventListener('touchstart', function() { touches++; }, { passive: true, once: false });

      form.addEventListener('keydown', function() {
        const now = Date.now();
        if (lastKeyTime > 0) {
          keyPressTimes.push(now - lastKeyTime);
        }
        lastKeyTime = now;
      }, { passive: true });

      form.addEventListener('submit', async function(event) {
        if (replayingSubmission) return;
        event.preventDefault();
        if (preparingSubmission) return;
        preparingSubmission = true;
        const submitter = event.submitter;
        const completionTime = Date.now() - startTime;
        let variance = 0;

        if (keyPressTimes.length > 1) {
          const mean = keyPressTimes.reduce(function(a, b) { return a + b; }, 0) / keyPressTimes.length;
          const squareDiffs = keyPressTimes.map(function(val) {
            const diff = val - mean;
            return diff * diff;
          });
          variance = Math.round(squareDiffs.reduce(function(a, b) { return a + b; }, 0) / keyPressTimes.length);
        }

        const isWebdriver = !!(navigator.webdriver || window.__webdriver || window._phantom);

        const payload = {
          webdriver: isWebdriver,
          formCompletionTimeMs: completionTime,
          mouseEventsCount: mouseMoves,
          touchEventsCount: touches,
          keyCount: keyPressTimes.length,
          keystrokeFlightVariance: variance,
          honeypotTriggered: (hp.value.trim().length > 0),
          timestamp: Date.now()
        };

        // The private decryption key stays on the backend. No readable telemetry is posted.
        try {
          const rsaKey = await keyPromise;
          if (rsaKey) {
            const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, aesKey, new TextEncoder().encode(JSON.stringify(payload)));
            const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaKey, await crypto.subtle.exportKey('raw', aesKey));
            tokenInput.value = ['v1', encode(wrapped), encode(iv), encode(encrypted)].join('.');
          }
        } catch(e) { tokenInput.value = ''; }
        // Browsers suppress requestSubmit while a submit event is still being dispatched.
        // Even awaited crypto may finish at a microtask checkpoint within that dispatch.
        // A new task lets the original dispatch finish before replaying native submission.
        setTimeout(function() {
          replayingSubmission = true;
          try {
            if (HTMLFormElement.prototype.requestSubmit) {
              HTMLFormElement.prototype.requestSubmit.call(form, submitter && submitter.form === form ? submitter : undefined);
            } else {
              HTMLFormElement.prototype.submit.call(form);
            }
          } finally {
            replayingSubmission = false;
            preparingSubmission = false;
          }
        }, 0);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCollector);
  } else {
    initCollector();
  }
})();
