(function () {
  'use strict';

  if (window.__DVSA_FIREFOX_STEALTH_LOADED__) return;
  window.__DVSA_FIREFOX_STEALTH_LOADED__ = true;

  const utils = {
    replaceProperty: (obj, prop, value) => {
      try {
        Object.defineProperty(obj, prop, {
          get: () => value,
          set: () => {},
          enumerable: true,
          configurable: true
        });
      } catch (e) {}
    },
    hideProperty: (obj, prop) => {
      try {
        Object.defineProperty(obj, prop, {
          get: () => undefined,
          enumerable: false,
          configurable: true
        });
      } catch (e) {}
    }
  };

  // 1. Hide navigator.webdriver & bot fingerprints
  try {
    const navProto = Object.getPrototypeOf(navigator);
    utils.hideProperty(navProto, 'webdriver');
    utils.hideProperty(navigator, 'webdriver');
  } catch (e) {}

  // 2. Hardware and screen definitions
  utils.replaceProperty(navigator, 'hardwareConcurrency', 8);
  utils.replaceProperty(navigator, 'deviceMemory', 8);
  utils.replaceProperty(navigator, 'languages', ['en-GB', 'en-US', 'en']);

  // 3. Permissions mock
  try {
    if (!window.Notification) {
      window.Notification = {
        permission: 'default',
        requestPermission: () => Promise.resolve('default')
      };
    }
  } catch (e) {}

  // 4. Force Page Visibility & Focus APIs to report ALWAYS VISIBLE & FOCUSED
  try {
    Object.defineProperty(document, 'hidden', {
      get: () => false,
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(document, 'webkitHidden', {
      get: () => false,
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(document, 'webkitVisibilityState', {
      get: () => 'visible',
      configurable: true,
      enumerable: true
    });

    document.hasFocus = function () {
      return true;
    };
  } catch (e) {
    console.error('[DVSA Stealth] Failed to override visibility properties:', e);
  }

  // 5. Intercept event listeners for visibility & focus loss
  try {
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const sensitiveEvents = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide', 'freeze'];
      if (sensitiveEvents.includes(type)) {
        const wrappedListener = function (event) {
          if (type === 'visibilitychange' || type === 'webkitvisibilitychange') {
            try {
              Object.defineProperty(event, 'target', { get: () => document });
            } catch (err) {}
          }
          if (type === 'blur' || type === 'focusout') {
            // Suppress blur event when tab or window loses focus
            return;
          }
          return typeof listener === 'function' ? listener.apply(this, arguments) : listener.handleEvent(event);
        };
        return originalAddEventListener.call(this, type, wrappedListener, options);
      }
      return originalAddEventListener.apply(this, arguments);
    };
  } catch (e) {
    console.error('[DVSA Stealth] Failed to intercept addEventListener:', e);
  }

  // 6. Silent Web Audio Keep-Alive Loop
  // Firefox does NOT throttle background tabs or suspend timers if the tab is outputting audio.
  let audioKeepAliveCtx = null;
  function startAudioKeepAlive() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioKeepAliveCtx) {
        audioKeepAliveCtx = new AudioCtx();
        const osc = audioKeepAliveCtx.createOscillator();
        const gain = audioKeepAliveCtx.createGain();
        // Inaudible silent gain level
        gain.gain.value = 0.00001;
        osc.connect(gain);
        gain.connect(audioKeepAliveCtx.destination);
        osc.start(0);
      }
      if (audioKeepAliveCtx.state === 'suspended') {
        audioKeepAliveCtx.resume();
      }
    } catch (e) {
      console.debug('[DVSA Stealth] Audio keep-alive note:', e);
    }
  }

  // Trigger audio keep-alive immediately and on user interactions
  startAudioKeepAlive();
  ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, startAudioKeepAlive, { passive: true, once: false });
  });

  // 7. Web Worker High Precision Unthrottled Timer Fallback
  try {
    const workerBlob = new Blob([`
      let timers = {};
      onmessage = function(e) {
        const { action, id, delay } = e.data;
        if (action === 'setInterval') {
          timers[id] = setInterval(() => postMessage({ id }), delay);
        } else if (action === 'clearInterval') {
          clearInterval(timers[id]);
          delete timers[id];
        }
      };
    `], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(workerBlob);
    const worker = new Worker(workerUrl);

    let nextTimerId = 1;
    const workerCallbacks = {};

    worker.onmessage = function (e) {
      const callback = workerCallbacks[e.data.id];
      if (callback) callback();
    };

    window.__DVSA_WORKER_SET_INTERVAL__ = function (fn, ms) {
      const id = nextTimerId++;
      workerCallbacks[id] = fn;
      worker.postMessage({ action: 'setInterval', id, delay: ms });
      return id;
    };

    window.__DVSA_WORKER_CLEAR_INTERVAL__ = function (id) {
      delete workerCallbacks[id];
      worker.postMessage({ action: 'clearInterval', id });
    };
  } catch (e) {
    console.debug('[DVSA Stealth] Worker timer init note:', e);
  }

  window.postMessage({
    type: 'DVSA_SNIPER_LOG',
    text: 'Firefox stealth & anti-pause background protections active (Visibility/Focus spoofed + Silent WebAudio keep-alive running)',
    level: 'info'
  }, '*');
})();
