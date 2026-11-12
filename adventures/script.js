/* =========================================================
   RESPAWN ADVENTURES, product page interactions.
   Numbers follow the game: Balance.swift (stats → power),
   DailyRift.swift (rift rules, FNV-1a day seed), Runes.swift
   (the shape recognizer, ported line for line), TrainingRaid.
   ========================================================= */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };

  /* When a section scrolls into view (or straight away without IO). */
  function whenVisible(el, cb, opts) {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { cb(e.isIntersecting, io); });
    }, opts || { threshold: 0.25 });
    io.observe(el);
  }

  /* ---------------- sound (the game's own chiptune effects, off by default) ---------------- */
  var Sfx = (function () {
    var names = ['hit', 'crit', 'swing', 'enrage', 'boss_kill', 'ultimate', 'spell', 'zap', 'fire',
                 'ward', 'coin', 'combo', 'ui', 'perfect', 'victory', 'dash'];
    var ctx = null, buffers = {}, on = false, loading = null;
    function load() {
      if (loading) return loading;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.resolve();
      ctx = new AC();
      // four at a time, so a small server isn't hit with 16 requests at once
      var queue = names.slice();
      function worker() {
        var n = queue.shift();
        if (!n) return Promise.resolve();
        return fetch('sfx/' + n + '.wav')
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
          .then(function (b) { return ctx.decodeAudioData(b); })
          .then(function (buf) { buffers[n] = buf; })
          .catch(function () { /* a missing sound just stays silent */ })
          .then(worker);
      }
      loading = Promise.all([worker(), worker(), worker(), worker()]);
      return loading;
    }
    function play(n, vol) {
      if (!on || !ctx || !buffers[n]) return;
      var src = ctx.createBufferSource();
      var gain = ctx.createGain();
      src.buffer = buffers[n];
      gain.gain.value = vol == null ? 0.45 : vol;
      src.connect(gain); gain.connect(ctx.destination);
      src.start();
    }
    return {
      toggle: function () {
        on = !on;
        if (on) { load(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
        return on;
      },
      play: play
    };
  })();

  var sfxBtn = $('#sfxBtn');
  sfxBtn.addEventListener('click', function () {
    var on = Sfx.toggle();
    sfxBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    sfxBtn.textContent = on ? '♪ SOUND ON' : '♪ SOUND OFF';
    if (on) setTimeout(function () { Sfx.play('coin'); }, 250);
  });

  /* ---------------- reveal on scroll ---------------- */
  var revealItems = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reduce) {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealItems.forEach(function (el) { rio.observe(el); });
  } else {
    revealItems.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------------- nav: highlight the section in view ---------------- */
  var navLinks = $$('.nav-links a');
  if ('IntersectionObserver' in window) {
    var nio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        navLinks.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    navLinks.forEach(function (a) { var s = $(a.getAttribute('href')); if (s) nio.observe(s); });
  }

  /* ---------------- hero embers ---------------- */
  (function embers() {
    var box = $('#embers');
    if (!box || reduce) return;
    for (var i = 0; i < 26; i++) {
      var e = document.createElement('i');
      var size = Math.random() < 0.3 ? 5 : (Math.random() < 0.5 ? 4 : 3);
      e.style.left = rand(2, 98).toFixed(1) + '%';
      e.style.width = e.style.height = size + 'px';
      e.style.setProperty('--dx', rand(-60, 60).toFixed(0) + 'px');
      e.style.animationDuration = rand(7, 14).toFixed(1) + 's';
      e.style.animationDelay = (-rand(0, 14)).toFixed(1) + 's';
      if (Math.random() < 0.35) { e.style.background = '#fb923c'; e.style.boxShadow = '0 0 8px #ea580c'; }
      box.appendChild(e);
    }
  })();

  /* =========================================================
     TRAINING TABLE: Respawn stats → hero power (Balance.swift)
     ========================================================= */
  var DEMO = { STR: 14, DEX: 8, SPD: 10, STM: 12, INT: 8, food: 84, sleep: 81, steps: 9200, streak: 5, trained: true };
  var hero = Object.assign({}, DEMO);

  function derive(h) {
    var marathon = h.steps >= 12000;
    var stride = !marathon && h.steps >= 8000;
    var wellFed = h.food >= 80, starving = h.food < 20;
    var rested = h.sleep >= 80, exhausted = h.sleep < 20;
    var drowsy = !exhausted && h.sleep < 50;
    var atk = 4 + 1.5 * h.STR;
    if (wellFed) atk *= 1.10;
    if (starving) atk *= 0.85;
    var maxHP = Math.round(30 + 6 * h.STM + 2 * h.STR);
    var maxMP = Math.round(10 + 3 * h.INT);
    var walkDash = marathon ? 0.75 : (stride ? 0.85 : 1);
    var effects = [];
    if (wellFed) effects.push(['🍴', 'WELL FED', '+10% attack, faster healing. Chills and poison 20% shorter']);
    if (starving) effects.push(['⚠', 'STARVING', '−15% attack, no natural healing', true]);
    if (rested) effects.push(['☾', 'WELL RESTED', 'Faster mana. Shrug off the first stun, and stuns and burns are 20% shorter']);
    if (drowsy) effects.push(['☁', 'DROWSY', 'Stuns and burns last 10% longer', true]);
    if (exhausted) effects.push(['z', 'EXHAUSTED', 'Spells cost 50% more, slow mana. Stuns and burns 25% longer', true]);
    if (h.streak > 0) effects.push(['🔥', 'STREAK BLESSING', '+' + Math.min(30, 2 * h.streak) + '% coins for a ' + h.streak + '-day streak']);
    if (h.streak >= 7) effects.push(['♥', 'SECOND WIND', 'Survive one killing blow per run']);
    if (h.trained) effects.push(['⚡', 'FIRED UP', 'Trained today: ultimate starts half charged']);
    if (marathon) effects.push(['🏃', 'MARATHON', '12,000+ steps today: 15% faster, dash 25% sooner, quicker attacks']);
    if (stride) effects.push(['🚶', 'STRIDE', '8,000+ steps today: 10% faster, dash recharges 15% sooner']);
    return {
      level: Math.round((h.STR + h.DEX + h.SPD + h.STM + h.INT) / 5),
      atk: Math.round(atk),
      maxHP: maxHP,
      maxMP: maxMP,
      hp: Math.max(1, Math.min(maxHP, Math.round(maxHP * (0.6 + 0.4 * h.food / 100)))),
      mp: Math.min(maxMP, Math.round(maxMP * Math.max(0.15, h.sleep / 100))),
      spell: Math.round(6 + 2 * h.INT),
      crit: Math.min(0.40, 0.05 + 0.006 * h.DEX),
      dodge: Math.min(0.30, 0.03 + 0.004 * h.DEX + 0.002 * h.SPD),
      swing: Math.max(0.3, 0.9 - 0.008 * h.SPD) * (marathon ? 0.95 : 1),
      dash: Math.max(1.0 * walkDash, (2.8 - 0.015 * h.DEX) * walkDash),
      effects: effects
    };
  }

  var stats = derive(hero);
  var prevReadout = {};

  function setReadout(id, val, num) {
    var el = document.getElementById(id);
    if (!el) return;
    var prev = prevReadout[id];
    el.textContent = val;
    el.classList.remove('up', 'down');
    if (prev != null && num !== prev) {
      void el.offsetWidth;
      el.classList.add(num > prev ? 'up' : 'down');
    }
    prevReadout[id] = num;
  }

  function renderTraining() {
    stats = derive(hero);
    ['STR', 'DEX', 'SPD', 'STM', 'INT'].forEach(function (k) { $('#t' + k).textContent = hero[k]; });
    $('#tStreak').textContent = hero.streak;
    $('#tLevel').textContent = stats.level;
    $('#tHp').textContent = stats.hp + '/' + stats.maxHP;
    $('#tMp').textContent = stats.mp + '/' + stats.maxMP;
    $('#tHpFill').style.width = (100 * stats.hp / stats.maxHP).toFixed(1) + '%';
    $('#tMpFill').style.width = (100 * stats.mp / stats.maxMP).toFixed(1) + '%';
    setReadout('rAtk', stats.atk, stats.atk);
    setReadout('rHp', stats.maxHP, stats.maxHP);
    setReadout('rMp', stats.maxMP, stats.maxMP);
    setReadout('rSpell', stats.spell, stats.spell);
    setReadout('rCrit', Math.round(stats.crit * 100) + '%', stats.crit);
    setReadout('rDodge', Math.round(stats.dodge * 100) + '%', stats.dodge);
    setReadout('rSwing', stats.swing.toFixed(2) + 's', -stats.swing);
    setReadout('rDash', stats.dash.toFixed(1) + 's', -stats.dash);
    $('#tEffects').innerHTML = stats.effects.map(function (e) {
      return '<li' + (e[3] ? ' class="bad"' : '') + '><i aria-hidden="true">' + e[0] + '</i><b>' + e[1] + '</b><span>' + e[2] + '</span></li>';
    }).join('');
    $('#oFood').textContent = hero.food + '%';
    $('#oSleep').textContent = hero.sleep + '%';
    $('#oSteps').textContent = fmt(hero.steps);
    Arena.syncHero();
    Runes.syncHero();
  }

  function trainPop(text, color) {
    var box = $('#trainPops');
    var el = document.createElement('span');
    el.className = 'pop';
    el.textContent = text;
    el.style.setProperty('--c', color);
    el.style.left = (50 + rand(-18, 18)).toFixed(0) + '%';
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 950);
  }

  var trainHero = $('#trainHero');
  function swing(el, ms) {
    el.classList.add('attack');
    clearTimeout(el._swing);
    el._swing = setTimeout(function () { el.classList.remove('attack'); }, ms || 260);
  }

  $$('.tbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-stat');
      if (hero[k] >= 100) { trainPop('MAX ' + k, '#9ca3af'); return; }
      hero[k] = Math.min(100, hero[k] + 2);
      hero.trained = true;
      var color = getComputedStyle(b).getPropertyValue('--c').trim() || '#fff';
      trainPop('+2 ' + k, color);
      swing(trainHero);
      Sfx.play('coin', 0.35);
      renderTraining();
    });
  });
  [['#sFood', 'food'], ['#sSleep', 'sleep'], ['#sSteps', 'steps']].forEach(function (p) {
    $(p[0]).addEventListener('input', function (e) { hero[p[1]] = +e.target.value; renderTraining(); });
  });
  $('#trainReset').addEventListener('click', function () {
    hero = Object.assign({}, DEMO);
    $('#sFood').value = hero.food; $('#sSleep').value = hero.sleep; $('#sSteps').value = hero.steps;
    prevReadout = {};
    Sfx.play('ui');
    renderTraining();
  });

  /* Hero Maker lineup and class cards: tap to swing */
  $$('.lineup-hero').forEach(function (b) {
    b.addEventListener('click', function () { swing($('.spr', b), 320); Sfx.play('swing', 0.35); });
  });
  $$('.class-card').forEach(function (b) {
    b.addEventListener('click', function () {
      b.classList.add('swing');
      clearTimeout(b._t);
      b._t = setTimeout(function () { b.classList.remove('swing'); }, 450);
      Sfx.play('swing', 0.35);
    });
  });

  /* =========================================================
     BOSS FIGHT
     ========================================================= */
  var BOSSES = [
    { row: 0, name: 'IRON WARDEN', world: 'Stone Halls · World 1', hp: 560, lore: 'A burning visor under a crowned helm, a red shield, and a mace that hits like a cart.' },
    { row: 1, name: 'SKELETON MAGE', world: 'Mossy Crypt · World 2', hp: 620, lore: 'A lich with bared ribs, a phylactery and circling runes. Its skeletons walk right over the spikes.' },
    { row: 2, name: 'STONE GOLEM', world: 'Old Mines · World 3', hp: 700, lore: 'A crystal heart, a shoulder of crystals and a pickaxe stuck in the other. It telegraphs its slam, so read the floor.' },
    { row: 3, name: 'FROST WRAITH', world: 'Frost Vault · World 4', hp: 663, lore: 'It fades into mist under a crown of ice. Its chill slows your feet and your swing.' },
    { row: 4, name: 'CRIMSON DRAGON', world: "Dragon's Keep · World 5", hp: 1170, lore: 'Fire shows between its belly plates, and it rears back before it breathes.' },
    { row: 5, name: 'THE MOTH QUEEN', world: 'Dreaming Fen · World 6', hp: 880, lore: 'Sings a lullaby: a slow ring of sleep dust you have to dash through.' },
    { row: 6, name: 'SOL, THE SUN SENTINEL', world: 'Co-op raid · Twin Sentinels', hp: 960, lore: 'One of the Twin Sentinels. Fell Sol alone and Luna raises Sol again in 6 seconds.' },
    { row: 7, name: 'LUNA, THE MOON SENTINEL', world: 'Co-op raid · Twin Sentinels', hp: 960, lore: 'The other twin. Fell Luna alone and Sol raises Luna again in 6 seconds.' },
    { row: 8, name: 'THE HOLLOW KING', world: 'Co-op raid', hp: 1250, lore: 'Marks a hero with Doom, and everyone standing with that hero shares the hit.' },
    { row: 9, name: 'STORM TITAN', world: 'Co-op raid', hp: 1400, lore: 'Static rings form around every hero, so spread out. Then the eye of the storm needs two heroes inside it.' }
  ];

  var Arena = (function () {
    var arena = $('#arena'), stage = $('#arenaStage');
    var bossEl = $('#arenaBoss'), bossBox = $('.arena-boss'), heroBox = $('.arena-hero'), heroEl = $('#arenaHero');
    var warn = $('#warn'), pops = $('#pops'), cutin = $('#cutin'), banner = $('#arenaBanner');
    var fightBtn = $('#fightBtn'), ctlRow = $('#ctlRow');
    var strikeBtn = $('#strikeBtn'), dashBtn = $('#dashBtn'), ultBtn = $('#ultBtn');
    var log = $('#arenaLog');
    var roster = $('#roster');

    var boss = BOSSES[4];
    var S = { hp: boss.hp, heroHp: 0, ult: 0, combo: 0, lastStrike: 0, lastHit: 0, enraged: false,
              running: false, dodgeWindow: false, dodged: false, nextCrit: false, busy: false, dashReady: 0 };
    var attackTimer = null, resolveTimer = null, dashTimer = null;
    var visible = false;

    /* roster */
    BOSSES.forEach(function (b, i) {
      if (i === 6) {
        var sep = document.createElement('div');
        sep.className = 'roster-sep'; sep.textContent = 'CO-OP RAIDS';
        roster.appendChild(sep);
      } else if (i === 0) {
        var sep0 = document.createElement('div');
        sep0.className = 'roster-sep'; sep0.textContent = 'WORLD BOSSES';
        roster.appendChild(sep0);
      }
      var t = document.createElement('button');
      t.type = 'button';
      t.className = 'boss-tile';
      t.setAttribute('role', 'radio');
      t.setAttribute('aria-checked', i === 4 ? 'true' : 'false');
      t.innerHTML = '<span class="spr boss" style="--row:' + b.row + '" aria-hidden="true"></span>' +
        '<span><b>' + b.name.replace(', THE ', ',<br>THE ') + '</b><small>' + b.world.split(' · ')[0] + '</small></span>';
      t.addEventListener('click', function () { pick(i); });
      roster.appendChild(t);
    });

    function pick(i) {
      boss = BOSSES[i];
      $$('.boss-tile', roster).forEach(function (t, j) { t.setAttribute('aria-checked', j === i ? 'true' : 'false'); });
      Sfx.play('ui');
      reset();
    }

    function setBossHp() {
      var pct = clamp(S.hp / boss.hp, 0, 1);
      $('#bossHpFill').style.width = (pct * 100).toFixed(1) + '%';
      $('#bossHp').textContent = fmt(Math.max(0, S.hp)) + '/' + fmt(boss.hp);
    }
    function setHeroHp() {
      var pct = clamp(S.heroHp / stats.maxHP, 0, 1);
      $('#heroHpFill').style.width = (pct * 100).toFixed(1) + '%';
      $('#heroHp').textContent = Math.max(0, Math.round(S.heroHp));
    }
    function setUlt() {
      S.ult = clamp(S.ult, 0, 100);
      $('#ultFill').style.width = S.ult.toFixed(0) + '%';
      $('#ultPct').textContent = Math.floor(S.ult) + '%';
      ultBtn.disabled = !(S.running && S.ult >= 100);
    }
    function setCombo() {
      $('#comboN').textContent = S.combo;
      $('#combo').classList.toggle('on', S.combo >= 3);
    }

    function pop(text, cls, side) {
      var el = document.createElement('span');
      el.className = 'dmg ' + (cls || '');
      el.textContent = text;
      var rect = stage.getBoundingClientRect();
      var target = side === 'hero' ? heroBox : bossBox;
      var tr = target.getBoundingClientRect();
      el.style.left = (tr.left - rect.left + tr.width * rand(0.25, 0.65)).toFixed(0) + 'px';
      el.style.top = (tr.top - rect.top + tr.height * rand(0.05, 0.35)).toFixed(0) + 'px';
      pops.appendChild(el);
      setTimeout(function () { el.remove(); }, 820);
    }
    function showBanner(html, cls, ms) {
      banner.className = 'arena-banner on ' + (cls || '');
      banner.innerHTML = '<div>' + html + '</div>';
      if (ms) setTimeout(function () { banner.classList.remove('on'); }, ms);
    }
    function shake() {
      if (reduce) return;
      stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake');
    }
    function say(t) { log.textContent = t; }

    function clearTimers() {
      clearTimeout(attackTimer); clearTimeout(resolveTimer);
      attackTimer = resolveTimer = null;
    }

    function reset() {
      clearTimers();
      S.running = false; S.enraged = false; S.busy = false; S.combo = 0; S.nextCrit = false;
      S.dodgeWindow = false; S.hp = boss.hp;
      S.heroHp = stats.hp;
      S.ult = hero.trained ? 50 : 0;   // Fired Up: trained today, half a bar
      arena.classList.remove('fighting', 'enraged');
      bossEl.className = 'spr boss';
      bossEl.style.setProperty('--row', boss.row);
      bossBox.classList.remove('dead', 'hit');
      warn.classList.remove('on');
      banner.className = 'arena-banner';
      $('#bossName').textContent = boss.name;
      $('#bossLore').innerHTML = '<b>' + boss.name + '</b> · ' + boss.world + '. ' + boss.lore;
      fightBtn.hidden = false;
      fightBtn.textContent = 'FIGHT';
      ctlRow.hidden = true;
      heroEl.classList.add('still');
      setBossHp(); setHeroHp(); setUlt(); setCombo();
      say(hero.trained ? 'Trained today: you start Fired Up, with half an ultimate bar.' : 'Press FIGHT to start.');
    }

    function start() {
      reset();
      S.running = true;
      arena.classList.add('fighting');
      heroEl.classList.remove('still');
      fightBtn.hidden = true;
      ctlRow.hidden = false;
      setUlt();
      say('STRIKE to attack. When a red ! appears over you, DASH to dodge it.');
      Sfx.play('swing');
      clearTimeout(attackTimer);
      attackTimer = setTimeout(windup, rand(1400, 2000));   // it opens quickly
      strikeBtn.focus({ preventScroll: true });
    }

    function schedule() {
      clearTimeout(attackTimer);
      if (!S.running) return;
      var wait = S.enraged ? rand(1500, 2400) : rand(2600, 3800);
      attackTimer = setTimeout(windup, wait);
    }

    function windup() {
      if (!S.running) return;
      if (!visible || S.busy) { schedule(); return; }
      bossEl.classList.add('windup');
      warn.classList.add('on');
      S.dodgeWindow = true; S.dodged = false;
      resolveTimer = setTimeout(resolveAttack, S.enraged ? 760 : 980);
    }

    function resolveAttack() {
      bossEl.classList.remove('windup');
      warn.classList.remove('on');
      S.dodgeWindow = false;
      if (!S.running) return;
      if (!S.dodged) {
        var dmg = Math.round(stats.maxHP * rand(0.13, 0.19) * (S.enraged ? 1.35 : 1));
        S.heroHp -= dmg;
        S.combo = Math.floor(S.combo / 2);   // a heavy hit halves the combo
        S.ult += 6;                           // taking hits charges a little
        pop('-' + dmg, 'bad', 'hero');
        heroBox.classList.remove('hurt'); void heroBox.offsetWidth; heroBox.classList.add('hurt');
        shake();
        Sfx.play('hit', 0.6);
        setHeroHp(); setCombo(); setUlt();
        if (S.heroHp <= 0) { lose(); return; }
      }
      schedule();
    }

    function strike() {
      if (!S.running || S.busy) return;
      var now = performance.now();
      if (now - S.lastStrike < stats.swing * 600) return;   // SPD sets how fast you can swing
      S.combo = now - S.lastStrike < 1600 ? S.combo + 1 : 1;
      S.lastStrike = now;
      var crit = S.nextCrit || Math.random() < stats.crit;
      S.nextCrit = false;
      var comboBonus = 1 + Math.min(20, Math.floor(S.combo / 5)) / 100;
      var dmg = Math.round(stats.atk * 2.2 * rand(0.9, 1.1) * comboBonus * (crit ? 1.75 : 1));
      swing(heroEl, 200);
      hitBoss(dmg, crit ? 'crit' : '', crit ? 'CRIT ' : '');
      S.ult += crit ? 12 : 9;
      if (S.combo > 0 && S.combo % 5 === 0) Sfx.play('combo', 0.4);
      setCombo(); setUlt();
    }

    function hitBoss(dmg, cls, prefix) {
      S.hp -= dmg;
      pop((prefix || '') + dmg, cls);
      bossBox.classList.remove('hit'); void bossBox.offsetWidth; bossBox.classList.add('hit');
      Sfx.play(cls === 'crit' ? 'crit' : 'hit', 0.45);
      setBossHp();
      if (S.hp <= 0) { win(); return; }
      if (!S.enraged && S.hp <= boss.hp * 0.35) enrage();
    }

    function enrage() {
      S.enraged = true;
      arena.classList.add('enraged');
      bossEl.classList.add('enraged');
      showBanner('ENRAGED!<small>BELOW 35%: IT HITS HARDER AND FASTER</small>', 'red', 1300);
      shake();
      Sfx.play('enrage', 0.55);
      say('Enraged below 35%. Its attacks come faster now: watch for the !');
    }

    function dash() {
      if (!S.running) return;
      var now = performance.now();
      if (now < S.dashReady) return;
      S.dashReady = now + stats.dash * 1000;
      heroBox.classList.remove('dash'); void heroBox.offsetWidth; heroBox.classList.add('dash');
      Sfx.play('dash', 0.45);
      if (S.dodgeWindow && !S.dodged) {
        S.dodged = true;
        S.nextCrit = true;
        S.ult += 15;
        pop('PERFECT!', 'good', 'hero');
        Sfx.play('perfect', 0.5);
        say('Perfect dodge: no damage, your next hit is a crit, and extra ultimate charge.');
        setUlt();
      }
      dashBtn.disabled = true;
      var tick = function () {
        var left = (S.dashReady - performance.now()) / 1000;
        if (left <= 0 || !S.running) { dashBtn.disabled = false; dashBtn.innerHTML = 'DASH <small>K</small>'; return; }
        dashBtn.innerHTML = 'DASH ' + left.toFixed(1) + 's';
        dashTimer = setTimeout(tick, 100);
      };
      clearTimeout(dashTimer); tick();
    }

    function ultimate() {
      if (!S.running || S.ult < 100 || S.busy) return;
      S.busy = true;
      S.ult = 0; setUlt();
      cutin.classList.remove('on'); void cutin.offsetWidth; cutin.classList.add('on');
      Sfx.play('ultimate', 0.55);
      setTimeout(function () {
        if (!S.running) { S.busy = false; return; }
        var crit = S.nextCrit || Math.random() < stats.crit;
        S.nextCrit = false;
        var dmg = Math.round(stats.atk * 12 * rand(0.95, 1.05) * (crit ? 1.75 : 1));
        shake();
        var heal = Math.round(stats.maxHP * 0.25);
        S.heroHp = Math.min(stats.maxHP, S.heroHp + heal);
        setHeroHp();
        pop('+' + heal, 'good', 'hero');
        S.busy = false;
        hitBoss(dmg, 'ult', crit ? 'CRIT ' : '');
        say('Heroic Strike: hits every enemy, heals 25% and pays bonus coins for a while.');
      }, reduce ? 50 : 900);
    }

    function win() {
      S.running = false; clearTimers(); setUlt();
      warn.classList.remove('on');
      bossEl.classList.remove('windup');
      bossBox.classList.add('dead');
      var pct = S.heroHp / stats.maxHP;
      var stars = pct > 0.66 ? '★★★' : (pct > 0.33 ? '★★☆' : '★☆☆');
      var coins = Math.round(boss.hp / 8) + (hero.streak ? Math.round(boss.hp / 8 * Math.min(0.3, hero.streak * 0.02)) : 0);
      setTimeout(function () {
        showBanner('BOSS DEFEATED<small>' + stars + ' · +' + coins + ' COINS</small>', '', 0);
      }, 500);
      Sfx.play('boss_kill', 0.55);
      setTimeout(function () { Sfx.play('victory', 0.45); }, 900);
      ctlRow.hidden = true;
      fightBtn.hidden = false;
      fightBtn.textContent = 'FIGHT AGAIN';
      say('Train in Respawn for a higher attack, then try a bigger boss.');
    }

    function lose() {
      S.running = false; clearTimers(); setUlt();
      warn.classList.remove('on');
      bossEl.classList.remove('windup');
      showBanner('DEFEATED<small>TRAIN, EAT, SLEEP. THEN RESPAWN.</small>', 'red', 0);
      Sfx.play('enrage', 0.3);
      ctlRow.hidden = true;
      fightBtn.hidden = false;
      fightBtn.textContent = 'RESPAWN';
      say('Raise STM for more health, or time your dashes for perfect dodges.');
    }

    fightBtn.addEventListener('click', start);
    strikeBtn.addEventListener('click', strike);
    dashBtn.addEventListener('click', dash);
    ultBtn.addEventListener('click', ultimate);
    bossBox.addEventListener('click', strike);

    document.addEventListener('keydown', function (e) {
      if (!visible || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var k = e.key.toLowerCase();
      if (k === 'j') { strike(); }
      else if (k === 'k') { dash(); }
      else if (k === 'l') { ultimate(); }
    });

    whenVisible(arena, function (v) { visible = v; }, { threshold: 0.3 });

    return {
      syncHero: function () {
        $('#aLv').textContent = stats.level;
        $('#aHp').textContent = stats.hp;
        $('#aAtk').textContent = stats.atk;
        if (!S.running) { S.heroHp = stats.hp; setHeroHp(); }
      },
      reset: reset
    };
  })();

  /* =========================================================
     RUNES: Runes.swift's recognizer, ported line for line
     ========================================================= */
  var RUNES = {
    lance:     { name: 'ARCANE LANCE',    cost: 8,  share: 0.25, color: '#a78bfa', sfx: 'spell', mult: 1.6 },
    lightning: { name: 'CHAIN LIGHTNING', cost: 14, share: 0.40, color: '#fde047', sfx: 'zap',   mult: 1.2 },
    flame:     { name: 'FLAME RUNE',      cost: 12, share: 0.35, color: '#fb923c', sfx: 'fire',  mult: 2.0 },
    ward:      { name: 'WARD',            cost: 10, share: 0.30, color: '#60a5fa', sfx: 'ward',  mult: 0.5 }
  };

  var Recognizer = (function () {
    var SHARP = 0.3;
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function resample(points, count) {
      var total = 0;
      for (var k = 1; k < points.length; k++) total += dist(points[k - 1], points[k]);
      var step = total / (count - 1);
      var out = [points[0]], carried = 0, prev = points[0], i = 1;
      while (i < points.length && out.length < count) {
        var next = points[i], d = dist(prev, next);
        if (carried + d >= step && d > 0) {
          var t = (step - carried) / d;
          var p = { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t };
          out.push(p); prev = p; carried = 0;
        } else { carried += d; prev = next; i++; }
      }
      while (out.length < count) out.push(points[points.length - 1]);
      return out;
    }
    function turning(p, span) {
      span = span || 3;
      var out = [];
      if (p.length <= span * 2) return out;
      for (var i = span; i < p.length - span; i++) {
        var ax = p[i].x - p[i - span].x, ay = p[i].y - p[i - span].y;
        var bx = p[i + span].x - p[i].x, by = p[i + span].y - p[i].y;
        if (Math.hypot(ax, ay) === 0 || Math.hypot(bx, by) === 0) { out.push(0); continue; }
        var d = Math.atan2(by, bx) - Math.atan2(ay, ax);
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        out.push(d / span);
      }
      return out;
    }
    function cornerCount(turns) {
      var count = 0, inCorner = false;
      turns.forEach(function (t) {
        if (Math.abs(t) > SHARP) { if (!inCorner) count++; inCorner = true; }
        else if (Math.abs(t) < SHARP * 0.4) inCorner = false;
      });
      return count;
    }
    function alternates(turns) {
      var signs = [], inCorner = false;
      turns.forEach(function (t) {
        if (Math.abs(t) > SHARP) { if (!inCorner) signs.push(t > 0); inCorner = true; }
        else if (Math.abs(t) < SHARP * 0.4) inCorner = false;
      });
      if (signs.length < 2) return false;
      for (var i = 1; i < signs.length; i++) if (signs[i] === signs[i - 1]) return false;
      return true;
    }
    function recognize(raw, minimumSize) {
      minimumSize = minimumSize || 30;
      var pts = raw.filter(function (p) { return isFinite(p.x) && isFinite(p.y); });
      if (pts.length < 4) return null;
      var pathLength = 0;
      for (var k = 1; k < pts.length; k++) pathLength += dist(pts[k - 1], pts[k]);
      var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      var size = Math.max(maxX - minX, maxY - minY);
      if (size < minimumSize || pathLength <= 0) return null;

      var points = resample(pts, 64);
      var center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      var start = points[0], end = points[points.length - 1];
      var gap = dist(start, end);
      var len = Math.hypot(end.x - start.x, end.y - start.y);
      var direction = len > 0 ? { x: (end.x - start.x) / len, y: (end.y - start.y) / len } : { x: 1, y: 0 };
      var straightness = gap / pathLength;
      var closed = gap < size * 0.35;

      if (!closed && straightness > 0.88) return { rune: 'lance', center: center, direction: direction };

      var turns = turning(points);
      var totalTurn = turns.reduce(function (s, t) { return s + Math.abs(t); }, 0);
      var corners = cornerCount(turns);

      if (closed) {
        var radii = points.map(function (p) { return dist(p, center); });
        var mean = radii.reduce(function (s, r) { return s + r; }, 0) / radii.length;
        var spread = Math.sqrt(radii.reduce(function (s, r) { return s + (r - mean) * (r - mean); }, 0) / radii.length) / Math.max(mean, 1e-9);
        if (corners <= 1 && spread < 0.3 && totalTurn > Math.PI * 1.5) return { rune: 'ward', center: center, direction: direction };
        if (corners >= 2 && corners <= 4 && totalTurn > Math.PI * 1.2) return { rune: 'flame', center: center, direction: direction };
        return null;
      }
      if (corners >= 2 && corners <= 6 && alternates(turns) && straightness > 0.25) {
        return { rune: 'lightning', center: center, direction: direction };
      }
      return null;
    }
    return { recognize: recognize };
  })();
  window.RA_RECOGNIZE = Recognizer.recognize;   // handy for poking at it from the console

  var Runes = (function () {
    var canvas = $('#runeCanvas');
    var ctx = canvas.getContext('2d');
    var W = 640, H = 420;
    var resultEl = $('#runeResult');
    var looks = new Image(), mons = new Image();
    looks.src = 'assets/sprites/looks.png';
    mons.src = 'assets/sprites/monsters.png';

    var HERO = { x: 320, y: 352 };
    var MON = [
      { k: 0, x: 140, y: 150 }, { k: 2, x: 470, y: 140 }, { k: 1, x: 320, y: 122 },
      { k: 3, x: 190, y: 285 }, { k: 6, x: 500, y: 270 }
    ].map(function (m) { return { k: m.k, x: m.x, y: m.y, ox: 0, oy: 0, flash: 0 }; });

    var mp = 34, maxMP = 34;
    var trail = [], drawing = false, effects = [], texts = [];
    var running = false, visible = false, autoDrawing = false;
    var t0 = performance.now();

    function setMp() {
      $('#runeMpFill').style.width = (100 * mp / maxMP).toFixed(1) + '%';
      $('#runeMp').textContent = Math.floor(mp) + '/' + maxMP;
    }

    function toCanvas(e) {
      var r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
    }

    function say(text, color) {
      resultEl.textContent = text;
      resultEl.style.color = color || 'rgba(245,243,255,.5)';
    }

    function costOf(r) { return Math.min(r.cost, Math.max(2, Math.ceil(maxMP * r.share))); }

    function damage(mult) { return Math.round(stats.spell * mult * rand(0.9, 1.1)); }

    function hitMon(m, dmg, color) {
      m.flash = 1;
      texts.push({ x: m.x + m.ox, y: m.y + m.oy - 30, text: String(dmg), color: color, t: 0 });
    }

    function cast(res) {
      var r = RUNES[res.rune];
      var cost = costOf(r);
      $$('.rune').forEach(function (b) { b.classList.toggle('cast', b.getAttribute('data-rune') === res.rune); });
      if (mp < cost) { say('NOT ENOUGH MP', '#ef4444'); Sfx.play('ui'); return; }
      mp -= cost; setMp();
      say(r.name + '!', r.color);
      Sfx.play(r.sfx, 0.5);
      var now = performance.now();
      if (res.rune === 'lance') {
        var dir = res.direction;
        var fx = { type: 'lance', t: now, dur: 520, x: HERO.x, y: HERO.y - 30, dx: dir.x, dy: dir.y };
        effects.push(fx);
        MON.forEach(function (m) {
          var px = m.x - fx.x, py = m.y - fx.y;
          var along = px * dir.x + py * dir.y;
          var off = Math.abs(px * dir.y - py * dir.x);
          if (along > 0 && off < 34) hitMon(m, damage(r.mult), r.color);
        });
      } else if (res.rune === 'lightning') {
        var chain = [{ x: HERO.x, y: HERO.y - 30 }], left = MON.slice(), from = chain[0];
        for (var j = 0; j < 4 && left.length; j++) {
          left.sort(function (a, b) { return Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y); });
          var next = left.shift();
          chain.push({ x: next.x, y: next.y });
          hitMon(next, damage(r.mult), r.color);
          from = next;
        }
        effects.push({ type: 'lightning', t: now, dur: 560, chain: chain, seed: Math.random() });
      } else if (res.rune === 'flame') {
        effects.push({ type: 'flame', t: now, dur: 700, x: res.center.x, y: res.center.y, parts: makeParts(res.center, 22) });
        MON.forEach(function (m) { if (Math.hypot(m.x - res.center.x, m.y - res.center.y) < 110) hitMon(m, damage(r.mult), r.color); });
      } else if (res.rune === 'ward') {
        effects.push({ type: 'ward', t: now, dur: 1400, x: HERO.x, y: HERO.y - 30 });
        MON.forEach(function (m) {
          var d = Math.hypot(m.x - HERO.x, m.y - HERO.y);
          if (d < 260) {
            var push = 46 * (1 - d / 300);
            m.ox += (m.x - HERO.x) / d * push;
            m.oy += (m.y - HERO.y) / d * push;
            hitMon(m, damage(r.mult), r.color);
          }
        });
      }
      kick();
    }

    function makeParts(c, n) {
      var out = [];
      for (var i = 0; i < n; i++) {
        var a = rand(0, Math.PI * 2), s = rand(60, 180);
        out.push({ x: c.x, y: c.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: Math.random() < 0.5 ? 4 : 6 });
      }
      return out;
    }

    function finishStroke() {
      drawing = false;
      var pts = trail.slice();
      var res = Recognizer.recognize(pts, 30);
      if (res) cast(res);
      else if (pts.length > 3) { say('THE RUNE FIZZLES', '#9ca3af'); }
      setTimeout(function () { if (!drawing) { trail = []; kick(); } }, 180);
    }

    /* pointer drawing */
    canvas.addEventListener('pointerdown', function (e) {
      if (autoDrawing) return;
      drawing = true;
      trail = [toCanvas(e)];
      canvas.setPointerCapture(e.pointerId);
      say('', null);
      kick();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = toCanvas(e), last = trail[trail.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 2) trail.push(p);
    });
    var endStroke = function () { if (drawing) finishStroke(); };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', function () { drawing = false; trail = []; });

    /* "draw it for me": canonical shapes run through the same recognizer */
    function demoShape(kind) {
      var pts = [], i, n;
      function line(a, b, steps) { for (var s = 0; s <= steps; s++) pts.push({ x: a.x + (b.x - a.x) * s / steps, y: a.y + (b.y - a.y) * s / steps }); }
      if (kind === 'lance') {
        line({ x: 300, y: 310 }, { x: 470, y: 140 }, 24);
      } else if (kind === 'lightning') {
        var z = [{ x: 150, y: 250 }, { x: 240, y: 150 }, { x: 320, y: 250 }, { x: 400, y: 150 }, { x: 490, y: 240 }];
        for (i = 1; i < z.length; i++) line(z[i - 1], z[i], 10);
      } else if (kind === 'flame') {
        var v = [{ x: 330, y: 110 }, { x: 430, y: 280 }, { x: 230, y: 280 }, { x: 330, y: 110 }];
        for (i = 1; i < v.length; i++) line(v[i - 1], v[i], 14);
      } else if (kind === 'ward') {
        n = 46;
        for (i = 0; i <= n; i++) {
          var a = -Math.PI / 2 + (i / n) * Math.PI * 2.04;
          pts.push({ x: 320 + Math.cos(a) * 110, y: 230 + Math.sin(a) * 92 });
        }
      }
      return pts.map(function (p) { return { x: p.x + rand(-1.5, 1.5), y: p.y + rand(-1.5, 1.5) }; });
    }

    function autoDraw(kind) {
      if (autoDrawing) return;
      autoDrawing = true;
      var pts = demoShape(kind);
      trail = [];
      say('', null);
      var i = 0, per = Math.max(1, Math.ceil(pts.length / 18));
      (function step() {
        for (var k = 0; k < per && i < pts.length; k++) trail.push(pts[i++]);
        kick();
        if (i < pts.length && !reduce) { setTimeout(step, 22); return; }
        while (i < pts.length) trail.push(pts[i++]);
        autoDrawing = false;
        drawing = true;
        finishStroke();
      })();
    }
    $$('.rune').forEach(function (b) {
      b.addEventListener('click', function () { autoDraw(b.getAttribute('data-rune')); });
    });

    /* rendering */
    function sprite(img, sx, sy, sw, sh, x, y, scale) {
      if (!img.complete || !img.naturalWidth) return;
      ctx.drawImage(img, sx, sy, sw, sh, Math.round(x - sw * scale / 2), Math.round(y - sh * scale), sw * scale, sh * scale);
    }
    function jag(a, b, seed, amt) {
      var out = [a], segs = 6;
      for (var i = 1; i < segs; i++) {
        var t = i / segs;
        var nx = -(b.y - a.y), ny = b.x - a.x, l = Math.hypot(nx, ny) || 1;
        var off = (Math.sin(seed * 999 + i * 12.9898) * 43758.5453 % 1) * amt;
        out.push({ x: a.x + (b.x - a.x) * t + nx / l * off, y: a.y + (b.y - a.y) * t + ny / l * off });
      }
      out.push(b);
      return out;
    }

    var last = performance.now();
    function frame(now) {
      var t = (now - t0) / 1000;
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      var decay = Math.pow(0.94, dt * 60);
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;

      // monsters
      MON.forEach(function (m, i) {
        var bob = Math.round(Math.sin(t * 3 + i) * 2);
        m.ox *= decay; m.oy *= decay;
        var x = m.x + m.ox, y = m.y + m.oy + bob;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(Math.round(x - 18), Math.round(m.y + m.oy + 4), 36, 6);
        if (m.flash > 0) { ctx.globalAlpha = 0.5 + 0.5 * Math.round(Math.sin(now / 30)); }
        sprite(mons, m.k * 16, 0, 16, 16, x, y + 6, 3);
        ctx.globalAlpha = 1;
        m.flash = Math.max(0, m.flash - 1.8 * dt);
      });

      // hero (walk cycle)
      var f = [0, 1, 2, 3][Math.floor(t * 5.5) % 4];
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(HERO.x - 20, HERO.y - 4, 40, 6);
      sprite(looks, f * 28, 0, 28, 36, HERO.x, HERO.y, 2);

      // effects
      effects = effects.filter(function (fx) {
        var p = (now - fx.t) / fx.dur;
        if (p >= 1) return false;
        ctx.save();
        if (fx.type === 'lance') {
          var w = 18 * (1 - p);
          ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = w + 6; ctx.globalAlpha = 0.35;
          ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(fx.x + fx.dx * 900, fx.y + fx.dy * 900); ctx.stroke();
          ctx.globalAlpha = 1; ctx.strokeStyle = '#ede9fe'; ctx.lineWidth = Math.max(2, w * 0.45);
          ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(fx.x + fx.dx * 900, fx.y + fx.dy * 900); ctx.stroke();
        } else if (fx.type === 'lightning') {
          ctx.globalAlpha = Math.round(now / 45) % 2 ? 1 : 0.55;
          for (var i = 1; i < fx.chain.length; i++) {
            var pts = jag(fx.chain[i - 1], fx.chain[i], fx.seed + i + Math.floor(now / 60), 16);
            ctx.strokeStyle = '#fde047'; ctx.lineWidth = 5;
            ctx.beginPath(); pts.forEach(function (q, k) { if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
          }
        } else if (fx.type === 'flame') {
          var r = 20 + 100 * p;
          ctx.globalAlpha = 0.5 * (1 - p);
          ctx.fillStyle = '#fb923c';
          ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1 - p; ctx.strokeStyle = '#fde047'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2); ctx.stroke();
          var dt = p * fx.dur / 1000;
          fx.parts.forEach(function (q) {
            ctx.fillStyle = q.size > 4 ? '#f97316' : '#fde047';
            ctx.fillRect(Math.round(q.x + q.vx * dt), Math.round(q.y + q.vy * dt - 80 * dt * dt), q.size, q.size);
          });
        } else if (fx.type === 'ward') {
          var rr = 30 + 160 * Math.min(1, p * 2.2);
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(fx.x, fx.y, rr, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 0.25 * (1 - p); ctx.fillStyle = '#93c5fd';
          ctx.beginPath(); ctx.arc(fx.x, fx.y, 44, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.9 * (1 - p); ctx.strokeStyle = '#bfdbfe'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(fx.x, fx.y, 44, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
        return true;
      });

      // the stroke being drawn
      if (trail.length > 1) {
        ctx.save();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(196,181,253,0.35)'; ctx.lineWidth = 14;
        ctx.beginPath(); trail.forEach(function (q, k) { if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
        ctx.strokeStyle = '#f5f3ff'; ctx.lineWidth = 4; ctx.stroke();
        ctx.restore();
      }

      // damage numbers
      ctx.font = '14px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      texts = texts.filter(function (tx) {
        tx.t += dt;
        if (tx.t > 0.9) return false;
        ctx.globalAlpha = 1 - tx.t / 0.9;
        ctx.fillStyle = '#000'; ctx.fillText(tx.text, tx.x + 2, tx.y - tx.t * 50 + 2);
        ctx.fillStyle = tx.color; ctx.fillText(tx.text, tx.x, tx.y - tx.t * 50);
        ctx.globalAlpha = 1;
        return true;
      });

      // mana comes back quickly here (the game's regen is slower)
      if (mp < maxMP) { mp = Math.min(maxMP, mp + 7 * dt); setMp(); }

      var busy = effects.length || texts.length || drawing || autoDrawing || mp < maxMP || MON.some(function (m) { return m.flash > 0 || Math.abs(m.ox) > 0.5; });
      if (visible && (busy || !reduce)) { requestAnimationFrame(frame); }
      else { running = false; }
    }

    function kick() {
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    }

    whenVisible(canvas, function (v) { visible = v; if (v) kick(); }, { threshold: 0.05 });
    looks.onload = mons.onload = kick;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);

    return {
      syncHero: function () {
        var was = maxMP;
        maxMP = stats.maxMP;
        mp = was ? Math.min(maxMP, mp * maxMP / was) : maxMP;
        if (mp > maxMP) mp = maxMP;
        setMp();
      }
    };
  })();

  /* =========================================================
     DAILY RIFT: DailyRift.swift (FNV-1a over the local date)
     ========================================================= */
  (function rift() {
    var WORLDS = [
      { name: 'STONE HALLS', bg: '#3a3442' }, { name: 'MOSSY CRYPT', bg: '#3b2f5c' },
      { name: 'OLD MINES', bg: '#4a3a28' }, { name: 'FROST VAULT', bg: '#1e3a5f' },
      { name: "DRAGON'S KEEP", bg: '#4a1717' }, { name: 'DREAMING FEN', bg: '#1f3a3a' }
    ];
    var TWISTS = [
      { key: 'swarm', icon: '🐜', name: 'SWARM', effect: 'Many more monsters, each weaker.', coins: 1 },
      { key: 'goldRush', icon: '💰', name: 'GOLD RUSH', effect: '+50% coins.', coins: 1.5 },
      { key: 'frenzy', icon: '⚡', name: 'FRENZY', effect: 'Monsters move faster. +30% coins.', coins: 1.3 }
    ];
    var hasBigInt = typeof BigInt === 'function';

    function fnv1a(text) {
      var h = BigInt('0xcbf29ce484222325');
      var prime = BigInt('0x100000001b3');
      var mask = BigInt('0xffffffffffffffff');
      var bytes = new TextEncoder().encode(text);
      for (var i = 0; i < bytes.length; i++) { h = ((h ^ BigInt(bytes[i])) * prime) & mask; }
      return h;
    }
    function dayKey(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    var key = dayKey(new Date());
    var world = WORLDS[1], twist = TWISTS[1];
    if (hasBigInt && window.TextEncoder) {
      world = WORLDS[Number(fnv1a(key + 'w') % BigInt(WORLDS.length))];
      twist = TWISTS[Number(fnv1a(key + 't') % BigInt(TWISTS.length))];
    }
    $('#riftName').textContent = 'RIFT OF THE ' + world.name;
    $('#riftBanner').style.setProperty('--rift-bg', world.bg);

    var inputs = { sleep: $('#rSleep'), steps: $('#rSteps'), meals: $('#rMeals'), streak: $('#rStreak'), trained: $('#rTrained') };
    var shown = {};

    function render() {
      var day = {
        sleep: +inputs.sleep.value, steps: +inputs.steps.value, meals: +inputs.meals.value,
        streak: +inputs.streak.value, trained: inputs.trained.checked
      };
      $('#oRSleep').textContent = day.sleep + '%';
      $('#oRSteps').textContent = fmt(day.steps);
      $('#oRMeals').textContent = day.meals;
      $('#oRStreak').textContent = day.streak + (day.streak === 1 ? ' day' : ' days');

      var on = [], off = [], coins = 1;
      if (day.sleep < 60) { on.push({ k: 'darkness', i: '🌙', n: 'DARK RIFT', t: 'You slept ' + day.sleep + '%. Pitch dark beyond your torch. +40% coins.' }); coins *= 1.4; }
      else if (day.sleep >= 85) on.push({ k: 'wellRested', i: '🛏', n: 'WELL RESTED', t: 'You slept ' + day.sleep + '%. +15% damage.' });
      else off.push({ k: 'wellRested', i: '🛏', n: 'WELL RESTED', t: 'Sleep 85% or more: +15% damage. (Under 60%, the rift goes dark.)' });
      if (day.steps >= 8000) on.push({ k: 'swiftFeet', i: '🚶', n: 'SWIFT FEET', t: fmt(day.steps) + ' steps today. +20% speed, faster dash.' });
      else off.push({ k: 'swiftFeet', i: '🚶', n: 'SWIFT FEET', t: 'Walk 8,000 steps: +20% speed, faster dash.' });
      if (day.meals >= 2) on.push({ k: 'feast', i: '🍴', n: 'FEAST', t: day.meals + ' meals logged today. Monsters drop food that heals.' });
      else off.push({ k: 'feast', i: '🍴', n: 'FEAST', t: 'Log 2 meals: monsters drop food that heals.' });
      if (day.streak >= 3) on.push({ k: 'eliteHunt', i: '👑', n: 'ELITE HUNT', t: day.streak + '-day streak. Elite monsters worth double coins.' });
      else off.push({ k: 'eliteHunt', i: '👑', n: 'ELITE HUNT', t: 'Keep a 3-day streak: elite monsters worth double coins.' });
      if (day.trained) on.push({ k: 'firedUp', i: '🔥', n: 'FIRED UP', t: 'You trained today. Your ultimate starts half charged.' });
      else off.push({ k: 'firedUp', i: '🔥', n: 'FIRED UP', t: 'Train today: your ultimate starts half charged.' });
      coins *= twist.coins;
      coins = Math.min(1.75, coins);

      var html = on.map(function (m) {
        var isNew = !shown[m.k];
        return '<li' + (isNew ? ' class="new"' : '') + '><i aria-hidden="true">' + m.i + '</i><b>' + m.n + '</b><span>' + m.t + '</span></li>';
      }).join('');
      html += '<li class="twist"><i aria-hidden="true">' + twist.icon + '</i><b>' + twist.name + ' <small>TODAY\'S TWIST</small></b><span>' + twist.effect + '</span></li>';
      html += off.map(function (m) {
        return '<li class="off"><i aria-hidden="true">' + m.i + '</i><b>' + m.n + '</b><span>' + m.t + '</span></li>';
      }).join('');
      $('#riftMods').innerHTML = html;
      shown = {};
      on.forEach(function (m) { shown[m.k] = true; });
      $('#riftCoins').textContent = '×' + coins.toFixed(2);
      $('#riftBanner').classList.toggle('dark', day.sleep < 60);
    }

    Object.keys(inputs).forEach(function (k) {
      inputs[k].addEventListener(k === 'trained' ? 'change' : 'input', render);
    });
    render();

    function clock() {
      var now = new Date();
      var mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      var mins = Math.max(0, Math.floor((mid - now) / 60000));
      $('#riftClock').textContent = 'NEW IN ' + Math.floor(mins / 60) + 'H ' + (mins % 60) + 'M';
      if (dayKey(now) !== key) location.reload();
    }
    clock();
    setInterval(clock, 30000);
  })();

  /* =========================================================
     TRAINING RAID: this week's boss (TrainingRaid.week, ISO weeks)
     ========================================================= */
  (function raid() {
    var NAMES = ['IRON WARDEN', 'SKELETON MAGE', 'STONE GOLEM', 'FROST WRAITH', 'CRIMSON DRAGON', 'THE MOTH QUEEN'];
    function isoWeek(d) {
      var date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var day = (date.getDay() + 6) % 7;            // Monday = 0
      date.setDate(date.getDate() - day + 3);         // the Thursday of this week
      var year = date.getFullYear();
      var jan4 = new Date(year, 0, 4);
      var week = 1 + Math.round(((date - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
      return { year: year, week: week };
    }
    var w = isoWeek(new Date());
    var row = (w.year * 53 + w.week) % 6;
    $('#raidBoss').style.setProperty('--row', row);
    $('#raidName').textContent = NAMES[row];

    var pool = 10000, hp = pool;
    var fill = $('#raidFill'), label = $('#raidHp'), days = $$('#raidDays li');
    function draw() {
      fill.style.width = (100 * hp / pool).toFixed(1) + '%';
      label.textContent = fmt(hp) + '/' + fmt(pool);
    }
    draw();
    var played = false;
    whenVisible($('.raid'), function (v, io) {
      if (!v || played) return;
      played = true;
      if (io) io.disconnect();
      var i = 0;
      (function next() {
        if (i >= days.length) {
          $('#raidEnd').innerHTML = '<b style="color:var(--gold);font-weight:400">' + fmt(hp) + ' HP LEFT.</b> Finish it in the arena for the weekly chest. (A sample week; this week\'s boss is real.)';
          return;
        }
        var li = days[i++];
        li.classList.add('on');
        hp = Math.max(0, hp - 2 * (+li.getAttribute('data-xp')));
        draw();
        if (+li.getAttribute('data-xp') > 0) Sfx.play('hit', 0.25);
        setTimeout(next, reduce ? 0 : 650);
      })();
    }, { threshold: 0.25 });
  })();

  /* =========================================================
     REP POWER: squats counted on the phone
     ========================================================= */
  (function reps() {
    var fig = $('#repFig'), body = $('.rep-body', fig);
    var nEl = $('#repN'), ult = $('#repUlt'), sayEl = $('#repSay');
    var WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
    var n = 0, pausing = false;
    function show() {
      nEl.textContent = n;
      ult.style.width = (n * 10) + '%';
    }
    if (reduce) { n = 10; show(); sayEl.textContent = 'SET COMPLETE: +10% DAMAGE NEXT FIGHT'; return; }
    body.addEventListener('animationiteration', function () {
      if (pausing) return;
      n++;
      show();
      sayEl.textContent = '"' + WORDS[n - 1] + '"';
      if (n >= 10) {
        pausing = true;
        fig.classList.remove('go');
        sayEl.textContent = 'SET COMPLETE: +10% DAMAGE NEXT FIGHT';
        Sfx.play('perfect', 0.35);
        setTimeout(function () {
          n = 0; show(); pausing = false;
          sayEl.textContent = '"STEP BACK: SHOW YOUR KNEES"';
          if (repVisible) fig.classList.add('go');
        }, 2800);
      }
    });
    var repVisible = false;
    whenVisible(fig, function (v) {
      repVisible = v;
      if (v && !pausing) fig.classList.add('go'); else fig.classList.remove('go');
    }, { threshold: 0.5 });
  })();

  /* =========================================================
     CO-OP ROOM: friends join, ready up, start
     ========================================================= */
  (function room() {
    var lis = $$('#room .room-list li');
    var status = $('#roomStatus'), startBtn = $('#roomStart');
    var steps = [
      function () { lis[1].classList.add('in'); status.textContent = 'ANA joined. Waiting for ANA to tap READY'; },
      function () { lis[1].classList.add('ready'); lis[2].classList.add('in'); status.textContent = 'KAI joined with a party boost (newer hero). Waiting for KAI to tap READY'; },
      function () { lis[3].classList.add('in'); lis[2].classList.add('ready'); status.textContent = 'JO joined. Waiting for JO to tap READY'; },
      function () { lis[3].classList.add('ready'); status.textContent = "Everyone's ready! Tap START"; startBtn.classList.add('go'); Sfx.play('ui'); }
    ];
    if (reduce) { steps.forEach(function (s) { s(); }); return; }
    var played = false;
    whenVisible($('#room'), function (v, io) {
      if (!v || played) return;
      played = true;
      if (io) io.disconnect();
      steps.forEach(function (s, i) { setTimeout(s, 700 + i * 1100); });
    }, { threshold: 0.3 });
  })();

  /* first paint */
  renderTraining();
  Arena.reset();
})();
