/**
 * Shield Guard Invisible Client Telemetry Collector
 * Passively captures keystroke variance, mouse/touch movement, form completion timing, and webdriver.
 * Zero external requests; serializes payload directly into _shield_token on form submit.
 */
(function() {
  'use strict';

  function initCollector() {
    const forms = document.querySelectorAll('#commentform, #review_form, form.comment-form');
    if (!forms.length) return;

    forms.forEach(function(form) {
      if (form.dataset.shieldInitialized) return;
      form.dataset.shieldInitialized = 'true';

      const startTime = Date.now();
      let mouseMoves = 0;
      let touches = 0;
      let keyPressTimes = [];
      let lastKeyTime = 0;

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

      form.addEventListener('submit', function() {
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

        // Encode as Base64 JSON
        try {
          tokenInput.value = btoa(JSON.stringify(payload));
        } catch(e) {
          tokenInput.value = JSON.stringify(payload);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCollector);
  } else {
    initCollector();
  }
})();
