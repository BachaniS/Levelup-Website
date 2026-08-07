/* RESPAWN site interactions — reveal on scroll, animated bars, boot terminal */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- reveal + bar fill on scroll ---- */
  function fillBars(root) {
    root.querySelectorAll('.xp-fill, .vital-fill, .qb-prog-fill').forEach(function (el) {
      var w = el.getAttribute('data-w');
      if (w != null) el.style.width = w + '%';
    });
    // energy ring (SVG stroke)
    root.querySelectorAll('.ring-fg').forEach(function (el) {
      var pct = parseFloat(el.getAttribute('data-pct')) || 0;
      var circ = 2 * Math.PI * 52; // r = 52
      el.style.strokeDasharray = circ;
      el.style.strokeDashoffset = circ * (1 - pct / 100);
    });
    // trend chart line draw-on
    root.querySelectorAll('.chart-line').forEach(function (el) {
      el.style.strokeDashoffset = '0';
    });
  }

  function reveal(el) {
    if (el.classList.contains('in')) return;
    el.classList.add('in');
    fillBars(el);
  }

  var items = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));

  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        reveal(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.15 });

    items.forEach(function (el) { io.observe(el); });

    // Deterministic initial pass: reveal anything already in the viewport now
    // (also covers headless renders where IO callbacks may not flush).
    var initial = function () {
      items.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < (window.innerHeight || 800) * 0.95 && r.bottom > 0) reveal(el);
      });
    };
    initial();
    window.addEventListener('load', initial);
  } else {
    items.forEach(reveal);
  }

  /* ---- boot terminal typing ---- */
  var lines = Array.prototype.slice.call(document.querySelectorAll('.term-line'));
  if (lines.length && !reduce) {
    var li = 0;
    function typeLine() {
      if (li >= lines.length) return;
      var el = lines[li];
      var full = el.getAttribute('data-text') || '';
      var i = 0;
      (function tick() {
        el.innerHTML = full.slice(0, i);
        i++;
        if (i <= full.length) {
          setTimeout(tick, 26 + Math.random() * 34);
        } else {
          li++;
          setTimeout(typeLine, 320);
        }
      })();
    }
    typeLine();
  } else {
    lines.forEach(function (el) { el.innerHTML = el.getAttribute('data-text') || ''; });
  }

  /* ---- subtle parallax on the phone ---- */
  var phone = document.querySelector('.phone');
  if (phone && !reduce && window.matchMedia('(pointer:fine)').matches) {
    window.addEventListener('mousemove', function (e) {
      var x = (e.clientX / window.innerWidth - 0.5) * 10;
      var y = (e.clientY / window.innerHeight - 0.5) * 10;
      phone.style.transform = 'perspective(900px) rotateY(' + (-x) + 'deg) rotateX(' + y + 'deg)';
    });
  }
})();
