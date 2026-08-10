/* =========================================================
   RESPAWN — site game layer
   Boot sequence · persistent HUD · scroll XP & levelling ·
   achievement toasts · playable quest board · synth SFX ·
   holographic card tilt · reticle cursor · scroll reveals.
   ========================================================= */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* '(hover:hover) and (pointer:fine)' == a real mouse; excludes touch devices
     that still report a fine pointer (stylus, some emulators). */
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* =======================================================
     1. SYNTH SFX  (WebAudio, no asset files)
     ======================================================= */
  var Sfx = (function () {
    var ctx = null, on = false, master = null;

    function ensure() {
      if (ctx) return ctx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.16;
      master.connect(ctx.destination);
      return ctx;
    }

    /* a short square-wave blip — the classic UI tick */
    function tone(freq, dur, type, vol, slideTo) {
      if (!on) return;
      var c = ensure();
      if (!c) return;
      if (c.state === 'suspended') c.resume();
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(vol == null ? 0.5 : vol, c.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(master);
      o.start(); o.stop(c.currentTime + dur + 0.02);
    }

    return {
      setOn: function (v) { on = v; if (v) ensure(); },
      isOn: function () { return on; },
      hover:  function () { tone(880, 0.05, 'square', 0.16); },
      click:  function () { tone(520, 0.09, 'square', 0.4, 900); },
      quest:  function () { tone(660, 0.09, 'square', 0.4); setTimeout(function () { tone(990, 0.14, 'square', 0.36); }, 80); },
      level:  function () {
        [523, 659, 784, 1046].forEach(function (f, i) {
          setTimeout(function () { tone(f, 0.18, 'square', 0.4); }, i * 85);
        });
      },
      boot:   function () { tone(330, 0.5, 'sawtooth', 0.22, 880); },
      deny:   function () { tone(200, 0.16, 'square', 0.3, 120); }
    };
  })();

  /* =======================================================
     2. PLAYER STATE
     ======================================================= */
  var player = {
    level: 1,
    xp: 0,          // 0..100 within the current level
    totalXp: 0,
    hp: 35,
    mp: 55
  };

  var hud       = $('#hud');
  var hudLevel  = $('#hudLevel');
  var hudXp     = $('#hudXp');
  var hudXpVal  = $('#hudXpVal');
  var hudPlayer = $('#hudPlayer');
  var hudClass  = $('#hudClass');

  var CLASSES = [
    'E-RANK PALADIN', 'D-RANK PALADIN', 'C-RANK KNIGHT',
    'B-RANK CRUSADER', 'A-RANK CHAMPION', 'S-RANK SOVEREIGN'
  ];

  var hudStrip   = $('#hudStrip');
  var hudStripLv = $('#hudStripLv');
  var hudStripXp = $('#hudStripXp');

  function renderHud() {
    var pct = Math.round(player.xp);
    if (hudStrip) {
      /* the strip shows overall progress across all 6 levels */
      hudStrip.style.width = clamp(((player.level - 1) * 100 + player.xp) / 6, 0, 100) + '%';
      hudStripLv.textContent = 'LV ' + player.level;
      hudStripXp.textContent = pct + '%';
    }
    if (!hudLevel) return;
    hudLevel.textContent = player.level;
    hudXp.style.width = player.xp + '%';
    hudXpVal.textContent = pct + '%';
    hudClass.textContent = CLASSES[clamp(player.level - 1, 0, CLASSES.length - 1)];
  }

  function addXp(amount, label) {
    player.totalXp += amount;
    player.xp += amount;
    while (player.xp >= 100 && player.level < 6) {
      player.xp -= 100;
      player.level++;
      levelUp();
    }
    if (player.level >= 6) player.xp = Math.min(player.xp, 100);
    renderHud();
    if (label) toast('xp', '+' + amount + ' XP', label);
  }

  function levelUp() {
    Sfx.level();
    hudPlayer.classList.remove('levelup');
    void hudPlayer.offsetWidth;      // restart the animation
    hudPlayer.classList.add('levelup');
    banner('LEVEL UP', 'PLAYER → LV ' + player.level);
    if (window.RESPAWN_3D) {
      window.RESPAWN_3D.pulse();
      window.RESPAWN_3D.boostAll(1.06);
    }
  }

  /* =======================================================
     3. TOASTS + LEVEL BANNER
     ======================================================= */
  var toastHost = $('#toasts');
  function toast(kind, k, t) {
    if (!toastHost) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'xp' ? ' xp' : '');
    el.innerHTML =
      '<span class="toast-ic">' + (kind === 'xp' ? '✦' : '🏆') + '</span>' +
      '<span><span class="toast-k">' + k + '</span><span class="toast-t">' + t + '</span></span>';
    toastHost.appendChild(el);
    /* never stack more than 3 — fast scrolling can otherwise bury the page */
    while (toastHost.children.length > 3) toastHost.removeChild(toastHost.firstChild);
    if (kind !== 'xp') Sfx.quest();
    setTimeout(function () { el.remove(); }, 4800);
  }

  var bannerEl = $('#lvlBanner');
  var bannerTxt = $('#lvlText');
  function banner(main, sub) {
    if (!bannerEl) return;
    bannerEl.querySelector('b').textContent = main;
    bannerTxt.textContent = sub;
    bannerEl.classList.remove('show');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
    setTimeout(function () { bannerEl.classList.remove('show'); }, 2000);
  }

  /* floating "+90 XP" at a screen position */
  function xpPop(x, y, text) {
    var el = document.createElement('div');
    el.className = 'xp-pop';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1100);
  }

  /* =======================================================
     4. BOOT SEQUENCE
     ======================================================= */
  var boot      = $('#boot');
  var bootFill  = $('#bootFill');
  var bootPct   = $('#bootPct');
  var bootLog   = $('#bootLog');
  var bootStart = $('#bootStart');
  var bootSkip  = $('#bootSkip');
  var bootStatus = $('#bootStatus');

  var BOOT_LINES = [
    '&gt; mounting character.dat ......... OK',
    '&gt; linking apple health ........... OK',
    '&gt; rebuilding stat curves ......... OK',
    '&gt; ml pipeline warm ............... OK',
    '&gt; quest board generated .......... OK'
  ];

  var alreadyBooted = /[?&]boot=0/.test(location.search);
  try { alreadyBooted = alreadyBooted || sessionStorage.getItem('respawn_booted') === '1'; } catch (e) {}

  function endBoot(withSound) {
    document.documentElement.classList.remove('booting');
    boot.classList.add('done');
    hud.classList.add('on');
    try { sessionStorage.setItem('respawn_booted', '1'); } catch (e) {}
    if (withSound) { Sfx.setOn(true); syncSfxBtn(); Sfx.boot(); }
    setTimeout(function () {
      toast('ach', 'ACHIEVEMENT UNLOCKED', 'Booted the system');
      addXp(10);
    }, 700);
    startTyping();
  }

  if (alreadyBooted || reduce) {
    /* returning within the session (or reduced motion): skip straight in */
    boot.classList.add('done');
    boot.style.transition = 'none';
    hud.classList.add('on');
    startTyping();
  } else {
    document.documentElement.classList.add('booting');
    var p = 0;
    var logIdx = 0;
    var tick = setInterval(function () {
      p += 4 + Math.random() * 11;
      if (p >= 100) {
        p = 100;
        clearInterval(tick);
        bootStatus.textContent = 'SYSTEM READY';
        bootStart.classList.add('ready');
      }
      bootFill.style.width = p + '%';
      bootPct.textContent = Math.round(p) + '%';

      var want = Math.floor((p / 100) * BOOT_LINES.length);
      while (logIdx < want && logIdx < BOOT_LINES.length) {
        var s = document.createElement('span');
        s.innerHTML = BOOT_LINES[logIdx];
        s.style.animationDelay = '0s';
        bootLog.appendChild(s);
        logIdx++;
      }
    }, 130);

    bootStart.addEventListener('click', function () { endBoot(true); });
    bootSkip.addEventListener('click', function () { endBoot(false); });
    /* Enter / Space also starts, like a real title screen */
    window.addEventListener('keydown', function onKey(e) {
      if (boot.classList.contains('done')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.removeEventListener('keydown', onKey);
        endBoot(true);
      }
    });
  }

  /* =======================================================
     5. SCROLL REVEALS + BAR FILLS
     ======================================================= */
  function fillBars(root) {
    $$('.xp-fill, .vital-fill, .qb-prog-fill, .sr-fill, .wg-bar i', root).forEach(function (el) {
      var w = el.getAttribute('data-w');
      if (w == null && el.classList.contains('sr-fill')) {
        var host = el.closest('.sr');
        w = host && host.getAttribute('data-v');
      }
      if (w != null) el.style.width = w + '%';
    });
    $$('.ring-fg', root).forEach(function (el) {
      var pct = parseFloat(el.getAttribute('data-pct')) || 0;
      var circ = 2 * Math.PI * 52;
      el.style.strokeDasharray = circ;
      el.style.strokeDashoffset = circ * (1 - pct / 100);
    });
    $$('.chart-line', root).forEach(function (el) { el.style.strokeDashoffset = '0'; });
  }

  function reveal(el) {
    if (el.classList.contains('in')) return;
    el.classList.add('in');
    fillBars(el);
  }

  var revealItems = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        reveal(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.15 });
    revealItems.forEach(function (el) { io.observe(el); });

    var initial = function () {
      revealItems.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < (window.innerHeight || 800) * 0.95 && r.bottom > 0) reveal(el);
      });
    };
    initial();
    window.addEventListener('load', initial);
  } else {
    revealItems.forEach(reveal);
  }

  /* section headings get their underline swipe */
  if ('IntersectionObserver' in window) {
    var headIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); headIo.unobserve(e.target); }
      });
    }, { threshold: 0.4 });
    $$('.section-head').forEach(function (el) { headIo.observe(el); });
  }

  /* =======================================================
     6. BOOT TERMINAL TYPING (hero)
     ======================================================= */
  var typingStarted = false;
  function startTyping() {
    if (typingStarted) return;
    typingStarted = true;
    var lines = $$('.term-line');
    if (!lines.length) return;
    if (reduce) {
      lines.forEach(function (el) { el.innerHTML = el.getAttribute('data-text') || ''; });
      return;
    }
    var li = 0;
    (function typeLine() {
      if (li >= lines.length) return;
      var el = lines[li];
      var full = el.getAttribute('data-text') || '';
      var i = 0;
      (function tick() {
        el.innerHTML = full.slice(0, i);
        i++;
        if (i <= full.length) setTimeout(tick, 26 + Math.random() * 34);
        else { li++; setTimeout(typeLine, 320); }
      })();
    })();
  }

  /* =======================================================
     7. WAYPOINT MINIMAP + SCROLL XP + ACHIEVEMENTS
     ======================================================= */
  var zones = $$('[data-wp]');
  var mapHost = $('#hudMap');
  var wpEls = [];

  zones.forEach(function (z) {
    var a = document.createElement('a');
    a.className = 'wp';
    a.href = '#' + z.id;
    a.innerHTML = '<span class="wp-name">' + z.getAttribute('data-wp') + '</span><span class="wp-dot"></span>';
    mapHost.appendChild(a);
    wpEls.push(a);
  });

  var ACHIEVEMENTS = {
    class:      'Class assigned — Paladin',
    attributes: 'Character sheet decoded',
    profile:    'Profile shape rendered',
    quests:     'Quest board discovered',
    focus:      'Dedicated Mode understood',
    analytics:  'Data pipeline traced',
    coach:      'Coach came online',
    widgets:    'Home screen equipped',
    download:   'Reached the end — Insert Coin'
  };
  var seen = {};

  /* scroll depth pays XP, capped so it can't outrun the quests */
  var maxDepthXp = 55;
  var depthXpGiven = 0;

  function onScroll() {
    var y = window.scrollY;
    var max = Math.max(1, document.body.scrollHeight - window.innerHeight);
    var pct = clamp(y / max, 0, 1);

    /* nav background */
    var nav = $('#nav');
    if (nav) nav.classList.toggle('stuck', y > 40);

    /* pay XP for new ground covered */
    var owed = Math.floor(pct * maxDepthXp) - depthXpGiven;
    if (owed > 0) { depthXpGiven += owed; addXp(owed); }

    /* active waypoint + achievements */
    var mid = window.innerHeight * 0.42;
    zones.forEach(function (z, i) {
      var r = z.getBoundingClientRect();
      var active = r.top <= mid && r.bottom >= mid;
      wpEls[i].classList.toggle('active', active);
      if (r.top < window.innerHeight * 0.6) wpEls[i].classList.add('visited');
      if (active && !seen[z.id] && ACHIEVEMENTS[z.id]) {
        seen[z.id] = true;
        toast('ach', 'ACHIEVEMENT UNLOCKED', ACHIEVEMENTS[z.id]);
        pulse3D();
      }
    });

    /* nav link highlighting */
    $$('.nav-links a').forEach(function (a) {
      var t = document.querySelector(a.getAttribute('href'));
      if (!t) return;
      var rr = t.getBoundingClientRect();
      a.classList.toggle('active', rr.top <= mid && rr.bottom >= mid);
    });
  }

  var scrollQueued = false;
  window.addEventListener('scroll', function () {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () { scrollQueued = false; onScroll(); });
  }, { passive: true });
  onScroll();

  /* =======================================================
     8. PLAYABLE QUEST BOARD
     ======================================================= */
  var board = $('#questBoard');
  if (board) {
    var quests   = $$('.quest-i', board);
    var qbCount  = $('#qbCount');
    var qbFill   = $('#qbFill');
    var qbXp     = $('#qbXp');
    var qbRating = $('#qbRating');
    var qbMin    = $('#qbMinutes');
    var qbLive   = $('#qbLive');
    var fcEarned = $('#fcEarned');
    var fcCleared = $('#fcCleared');
    var fcBanked = $('#fcBanked');

    var RATINGS = [
      { n: 0, g: 'F', c: '#64748b' }, { n: 1, g: 'D', c: '#ef4444' },
      { n: 2, g: 'C', c: '#f59e0b' }, { n: 3, g: 'B', c: '#3b82f6' },
      { n: 4, g: 'A', c: '#22c55e' }, { n: 5, g: 'S', c: '#facc15' }
    ];

    var cleared = 0, boardXp = 0;

    function renderBoard() {
      var pct = (cleared / quests.length) * 100;
      qbCount.textContent = cleared + ' / ' + quests.length;
      qbFill.style.width = pct + '%';
      qbFill.setAttribute('data-w', pct);
      qbXp.textContent = '+' + boardXp + ' XP earned today';
      var r = RATINGS[cleared] || RATINGS[0];
      qbRating.textContent = r.g;
      qbRating.style.setProperty('--c', r.c);
      qbMin.textContent = (cleared * 30) + ' min';

      if (fcEarned)  fcEarned.textContent = (cleared * 30) + ' min';
      if (fcCleared) fcCleared.textContent = cleared + ' / ' + quests.length;
      if (fcBanked) {
        fcBanked.innerHTML = cleared
          ? '✓ ' + cleared + ' quest' + (cleared > 1 ? 's' : '') + ' cleared → <b>+' + (cleared * 30) + ' min</b> banked today'
          : 'Clear quests on the board above to bank time →';
      }
      if (qbLive) qbLive.textContent = cleared === quests.length ? 'board cleared!' : 'tap to play';
    }

    function complete(q, ev) {
      if (q.classList.contains('cleared')) { Sfx.deny(); return; }
      q.classList.add('cleared', 'just-cleared');
      setTimeout(function () { q.classList.remove('just-cleared'); }, 600);

      var xp = parseInt(q.getAttribute('data-xp'), 10) || 40;
      var stat = q.getAttribute('data-stat');
      cleared++;
      boardXp += xp;

      var btn = $('.q-btn.done, .q-btn.quiz', q);
      if (btn) { btn.textContent = '✓ DONE'; btn.className = 'q-btn complete-done'; }
      var skip = $('.q-btn.skip', q);
      if (skip) skip.remove();

      Sfx.quest();
      var r = q.getBoundingClientRect();
      var px = ev && ev.clientX ? ev.clientX : r.left + r.width / 2;
      xpPop(px, r.top + r.height / 2, '+' + xp + ' XP');
      addXp(Math.round(xp / 6));

      /* feed the radar so the shape visibly grows */
      if (stat) {
        var el = $('.sr[data-stat="' + stat + '"]');
        var cur = el ? parseFloat(el.getAttribute('data-v')) : 50;
        var next = clamp(cur + 12, 8, 100);
        if (el) {
          el.setAttribute('data-v', next);
          var f = $('.sr-fill', el);
          if (f) f.style.width = next + '%';
        }
        setStat(stat, next / 100);
        pulse3D();
      }

      renderBoard();

      if (cleared === quests.length) {
        setTimeout(function () {
          banner('S RANK', 'BOARD CLEARED · +150 MIN');
          toast('ach', 'ACHIEVEMENT UNLOCKED', 'Perfect day — full board cleared');
          Sfx.level();
          pulse3D();
        }, 450);
      }
    }

    quests.forEach(function (q) {
      q.addEventListener('click', function (e) {
        if (e.target.classList.contains('skip')) {
          e.stopPropagation();
          q.style.opacity = '.35';
          Sfx.deny();
          return;
        }
        complete(q, e);
      });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); complete(q, null); }
      });
    });

    $('#qbReplay').addEventListener('click', function () {
      cleared = 0; boardXp = 0;
      quests.forEach(function (q) {
        q.classList.remove('cleared');
        q.style.opacity = '';
        var b = $('.q-btn', q);
        var isQuiz = q.getAttribute('data-stat') === 'INT';
        if (b) {
          b.className = 'q-btn ' + (isQuiz ? 'quiz' : 'done');
          b.textContent = isQuiz ? 'TAKE QUIZ' : '✓ COMPLETE';
        }
        if (!$('.q-btn.skip', q)) {
          var s = document.createElement('span');
          s.className = 'q-btn skip';
          s.textContent = 'SKIP';
          $('.q-actions', q).appendChild(s);
        }
      });
      Sfx.click();
      renderBoard();
    });

    renderBoard();
  }

  /* =======================================================
     8b. 2D RADAR  (always drawn; revealed when 3D is absent)
     ======================================================= */
  var STAT_DEFS = [
    { k: 'STR', c: '#ef4444' }, { k: 'DEX', c: '#f97316' },
    { k: 'SPD', c: '#f59e0b' }, { k: 'STM', c: '#ec4899' },
    { k: 'INT', c: '#818cf8' }
  ];
  var CX = 160, CY = 160, RR = 118;

  function axis(i, r) {
    var a = (-90 + i * 72) * Math.PI / 180;
    return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
  }
  function ring(r) {
    return STAT_DEFS.map(function (_, i) { return axis(i, r).map(Math.round).join(','); }).join(' ');
  }

  var Radar2D = (function () {
    var svg = $('#radar2d');
    if (!svg) return { set: function () {} };
    var NS = 'http://www.w3.org/2000/svg';
    var parts = [];

    /* guide rings */
    [0.25, 0.5, 0.75, 1].forEach(function (f, i) {
      parts.push('<polygon points="' + ring(RR * f) + '" fill="none" stroke="#2a4a7f" ' +
        'stroke-width="1" opacity="' + (i === 3 ? 0.85 : 0.4) + '"/>');
    });
    /* spokes */
    STAT_DEFS.forEach(function (_, i) {
      var p = axis(i, RR);
      parts.push('<line x1="' + CX + '" y1="' + CY + '" x2="' + p[0].toFixed(1) + '" y2="' +
        p[1].toFixed(1) + '" stroke="#2a4a7f" stroke-width="1" opacity=".45"/>');
    });
    /* the player shape */
    parts.push('<polygon id="r2shape" points="" fill="rgba(59,130,246,.20)" stroke="#60a5fa" ' +
      'stroke-width="2.5" stroke-linejoin="round"/>');
    /* vertex dots + labels */
    STAT_DEFS.forEach(function (s, i) {
      parts.push('<circle id="r2dot' + i + '" r="5" fill="' + s.c + '"/>');
      var lp = axis(i, RR + 24);
      parts.push('<text x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '" fill="' + s.c +
        '" font-family="\'Press Start 2P\', monospace" font-size="11" text-anchor="middle" ' +
        'dominant-baseline="middle">' + s.k + '</text>');
    });
    svg.innerHTML = parts.join('');

    var shape = svg.querySelector('#r2shape');
    var dots = STAT_DEFS.map(function (_, i) { return svg.querySelector('#r2dot' + i); });
    var vals = STAT_DEFS.map(function () { return 0.12; });

    function draw() {
      var pts = vals.map(function (v, i) {
        return axis(i, RR * v).map(function (n) { return n.toFixed(1); }).join(',');
      });
      shape.setAttribute('points', pts.join(' '));
      pts.forEach(function (p, i) {
        var xy = p.split(',');
        dots[i].setAttribute('cx', xy[0]);
        dots[i].setAttribute('cy', xy[1]);
      });
    }
    draw();

    return {
      set: function (key, v) {
        var i = STAT_DEFS.findIndex(function (s) { return s.k === key; });
        if (i < 0) return;
        vals[i] = clamp(v, 0.08, 1);
        draw();
      }
    };
  })();

  /* single entry point so 3D and 2D never drift apart */
  function setStat(key, v01) {
    if (window.RESPAWN_3D) window.RESPAWN_3D.setStat(key, v01);
    Radar2D.set(key, v01);
  }
  function pulse3D() {
    if (window.RESPAWN_3D) window.RESPAWN_3D.pulse();
  }

  /* seed both renderers from the readout markup */
  function seedStats() {
    $$('.sr').forEach(function (sr) {
      var v = parseFloat(sr.getAttribute('data-v'));
      if (!isNaN(v)) setStat(sr.getAttribute('data-stat'), v / 100);
    });
  }
  seedStats();

  window.addEventListener('respawn:3dready', seedStats);
  window.addEventListener('respawn:3dfailed', function () {
    document.body.classList.add('no3d');
    var w = $('#world');
    if (w) w.style.display = 'none';
    var hint = $('#radarHint');
    if (hint) hint.textContent = 'TAP A STAT TO REDRAW THE SHAPE';
    seedStats();
  });

  /* =======================================================
     9. STAT READOUT → RADAR
     ======================================================= */
  $$('.sr').forEach(function (sr) {
    sr.addEventListener('click', function () {
      var stat = sr.getAttribute('data-stat');
      var v = clamp(parseFloat(sr.getAttribute('data-v')) + 9, 8, 100);
      sr.setAttribute('data-v', v);
      var f = $('.sr-fill', sr);
      if (f) f.style.width = v + '%';
      $$('.sr').forEach(function (o) { o.classList.remove('active'); });
      sr.classList.add('active');
      Sfx.click();
      var r = sr.getBoundingClientRect();
      xpPop(r.left + r.width / 2, r.top + r.height / 2, '+' + stat);
      setStat(stat, v / 100);
      pulse3D();
      addXp(2);
    });
  });

  /* =======================================================
     10. HOLOGRAPHIC TILT
     ======================================================= */
  if (finePointer && !reduce) {
    $$('.holo').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--mx', (px * 100) + '%');
        card.style.setProperty('--my', (py * 100) + '%');
        card.classList.add('tilting');
        card.style.transform =
          'perspective(1000px) rotateY(' + ((px - 0.5) * 9).toFixed(2) + 'deg) ' +
          'rotateX(' + ((0.5 - py) * 9).toFixed(2) + 'deg) translateZ(6px)';
      });
      card.addEventListener('pointerleave', function () {
        card.classList.remove('tilting');
        card.style.transform = '';
      });
    });

    /* keep the original hero phone parallax */
    var phone = $('.phone');
    if (phone) {
      window.addEventListener('pointermove', function (e) {
        var x = (e.clientX / window.innerWidth - 0.5) * 10;
        var y = (e.clientY / window.innerHeight - 0.5) * 10;
        phone.style.transform = 'perspective(900px) rotateY(' + (-x) + 'deg) rotateX(' + y + 'deg)';
      }, { passive: true });
    }
  }

  /* =======================================================
     11. RETICLE CURSOR
     ======================================================= */
  var reticle = $('#reticle');
  if (finePointer && !reduce && reticle) {
    document.body.classList.add('has-reticle');
    var rx = window.innerWidth / 2, ry = window.innerHeight / 2, tx = rx, ty = ry;

    window.addEventListener('pointermove', function (e) { tx = e.clientX; ty = e.clientY; }, { passive: true });
    (function loop() {
      rx += (tx - rx) * 0.4;
      ry += (ty - ry) * 0.4;
      reticle.style.transform = 'translate(' + rx + 'px,' + ry + 'px)';
      requestAnimationFrame(loop);
    })();

    var HOT = 'a, button, .quest-i, .sr, .log-row, .er, .sync-chip, .rank, .feat, [role="button"]';
    document.addEventListener('pointerover', function (e) {
      if (e.target.closest && e.target.closest(HOT)) {
        reticle.classList.add('hot');
        Sfx.hover();
      }
    });
    document.addEventListener('pointerout', function (e) {
      if (e.target.closest && e.target.closest(HOT)) reticle.classList.remove('hot');
    });
    /* hide the reticle when the pointer leaves the window */
    document.addEventListener('mouseleave', function () { reticle.style.opacity = '0'; });
    document.addEventListener('mouseenter', function () { reticle.style.opacity = ''; });
  }

  /* =======================================================
     12. HUD CONTROLS
     ======================================================= */
  var sfxBtn = $('#sfxBtn');
  function syncSfxBtn() {
    if (!sfxBtn) return;
    var on = Sfx.isOn();
    sfxBtn.textContent = on ? '♪ SFX ON' : '♪ SFX OFF';
    sfxBtn.setAttribute('aria-pressed', String(on));
  }
  if (sfxBtn) {
    sfxBtn.addEventListener('click', function () {
      Sfx.setOn(!Sfx.isOn());
      syncSfxBtn();
      if (Sfx.isOn()) Sfx.click();
    });
  }

  var fxBtn = $('#fxBtn');
  if (fxBtn) {
    var fxOn = true;
    fxBtn.addEventListener('click', function () {
      fxOn = !fxOn;
      fxBtn.textContent = fxOn ? '◈ FX ON' : '◈ FX OFF';
      fxBtn.setAttribute('aria-pressed', String(fxOn));
      var w = $('#world');
      if (w) w.style.display = fxOn ? '' : 'none';
      if (window.RESPAWN_3D) window.RESPAWN_3D.setPaused(!fxOn);
      document.querySelectorAll('.scanlines').forEach(function (s) {
        s.style.display = fxOn ? '' : 'none';
      });
      Sfx.click();
    });
  }

  /* global click blip for anything interactive */
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a, .btn, .ctl-btn')) Sfx.click();
  });

  /* =======================================================
     13. KONAMI CODE — max out the character
     ======================================================= */
  var KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  var kIdx = 0;
  window.addEventListener('keydown', function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    kIdx = (k === KONAMI[kIdx]) ? kIdx + 1 : (k === KONAMI[0] ? 1 : 0);
    if (kIdx === KONAMI.length) {
      kIdx = 0;
      player.level = 6; player.xp = 100;
      renderHud();
      banner('S RANK', 'SOVEREIGN UNLOCKED');
      toast('ach', 'SECRET ACHIEVEMENT', 'Konami code — all stats maxed');
      Sfx.level();
      ['STR','DEX','SPD','STM','INT'].forEach(function (s) { setStat(s, 1); });
      pulse3D();
      $$('.sr').forEach(function (sr) {
        sr.setAttribute('data-v', 100);
        var f = $('.sr-fill', sr);
        if (f) f.style.width = '100%';
      });
    }
  });

  /* =======================================================
     14. INIT
     ======================================================= */
  renderHud();
  syncSfxBtn();

})();
