// Sage guide interactivity. Range lab + hold-and-release tap-fire
// simulator, shared by every guide in the series. Both widgets are
// driven by the weapon profile on their containers, so no per-gun
// code lives here: the simulator reads data-rpm, data-base-cof,
// data-bloom, data-distance off #burstSim, and the range lab reads
// data-rpm, data-dmg-max, data-dmg-min, data-max-range, data-min-range,
// data-hs-mult and data-advice-0..3 off .lab (band names, limits and chip
// classes are data-band-names / data-band-limits / data-band-classes,
// comma-separated; they default to the canonical Point blank / Sweet
// spot / Controlled range / Plinking range at 8/25/50 with classes
// situ/good/good/skip — a few guns differ, e.g. the SAW family runs its
// third band to 54 m and the Ursa renames the last two). Two guns need
// more: the AR-100 shows damage as a sentence (#labDmgLine) instead of
// a #labDmg cell, and the NSX Yumi is a charge weapon — its TTK comes
// from data-charge-ms / data-burst / data-cycle-ms / data-bullet-ms
// (wind-up + one cycle per burst of 5 + one bullet interval per extra
// round), which replaces the (chest-1)*REFIRE formula when present.
// Census single segment (dmg-max at max-range sliding linearly to
// dmg-min at min-range); the wiki's mid-range values are the same
// line sampled, so displayed damage agrees to within rounding and
// shots-to-kill / TTK agree exactly.
// Module scripts run after parsing, so the getElementById calls
// below see the full DOM.
      (function () {
        var lab = document.querySelector('.lab');
        var slider = document.getElementById('labRange');
        if (!lab || !slider) return;
        // Pages that keep their own lab script carry no standard
        // data-rpm (sniper cycle/OHK labs, pump/bolt/tap trainers) or
        // a data-pellets marker (shotgun pull labs) — the shared lab
        // stays out so it cannot clobber their values with NaN.
        if (!lab.dataset.rpm || lab.dataset.pellets) return;
        var distEl = document.getElementById('labDist');
        var bandEl = document.getElementById('labBand');
        var dmgEl = document.getElementById('labDmg');
        var dmgLineEl = document.getElementById('labDmgLine'); // AR-100: sentence instead of a cell
        var headEl = document.getElementById('labHead');
        var chestEl = document.getElementById('labChest');
        var ttkEl = document.getElementById('labTtk');
        var advEl = document.getElementById('labAdvice');
        var rpm = parseFloat(lab.dataset.rpm);
        var dmgMax = parseFloat(lab.dataset.dmgMax);
        var dmgMin = parseFloat(lab.dataset.dmgMin);
        var maxRange = parseFloat(lab.dataset.maxRange);
        var minRange = parseFloat(lab.dataset.minRange);
        var hsMult = parseFloat(lab.dataset.hsMult || '2');
        var REFIRE = 60 / rpm; // seconds between shots
        // Charge weapons (NSX Yumi): TTK = wind-up + one cycle per full
        // burst + one bullet interval per extra round in the last burst.
        var charge = null;
        if (lab.dataset.chargeMs && lab.dataset.burst && lab.dataset.cycleMs && lab.dataset.bulletMs) {
          charge = {
            chargeMs: parseFloat(lab.dataset.chargeMs),
            burst: parseInt(lab.dataset.burst, 10),
            cycleMs: parseFloat(lab.dataset.cycleMs),
            bulletMs: parseFloat(lab.dataset.bulletMs),
          };
        }

        function damageAt(d) {
          if (d <= maxRange) return dmgMax;
          if (d >= minRange) return dmgMin;
          return dmgMax - (d - maxRange) * (dmgMax - dmgMin) / (minRange - maxRange);
        }
        var BAND_NAMES = (lab.dataset.bandNames || 'Point blank,Sweet spot,Controlled range,Plinking range').split(',');
        var BAND_LIMITS = (lab.dataset.bandLimits || '8,25,50').split(',').map(Number);
        var BAND_CLASSES = (lab.dataset.bandClasses || 'situ,good,good,skip').split(',');
        var bandChip = lab.dataset.bandChip !== '0'; // AR-100 / T1S show the band as plain text, not a chip
        function adviceFor(d) {
          for (var i = 0; i < BAND_LIMITS.length; i++) {
            if (d < BAND_LIMITS[i]) return [BAND_NAMES[i], lab.dataset['advice-' + i] || '', BAND_CLASSES[i] || 'good'];
          }
          return [BAND_NAMES[BAND_NAMES.length - 1], lab.dataset['advice-' + (BAND_NAMES.length - 1)] || '', BAND_CLASSES[BAND_CLASSES.length - 1] || 'skip'];
        }
        function update() {
          var d = parseInt(slider.value, 10);
          var dmg = damageAt(d);
          var head = Math.ceil(1000 / (dmg * hsMult));
          var chest = Math.ceil(1000 / dmg);
          var ttk;
          if (charge) {
            var k = chest - 1;
            ttk = (charge.chargeMs + Math.floor(k / charge.burst) * charge.cycleMs + (k % charge.burst) * charge.bulletMs) / 1000;
          } else {
            ttk = (chest - 1) * REFIRE;
          }
          var a = adviceFor(d);
          distEl.textContent = d;
          if (dmgEl) dmgEl.textContent = Math.round(dmg);
          if (dmgLineEl) dmgLineEl.textContent = Math.round(dmg) + ' damage per bullet at this range';
          headEl.textContent = head;
          chestEl.textContent = chest;
          ttkEl.textContent = ttk.toFixed(2) + ' s';
          bandEl.textContent = a[0];
          advEl.textContent = a[1];
          if (bandChip) bandEl.className = 'chip ' + a[2];
        }
        slider.addEventListener('input', update);
        update();
      })();

      /* ---------- hold-and-release simulator (reusable across the Sage series) ----------
         The window is driven by a weapon profile on its container element:
         data-rpm, data-base-cof (degrees), data-bloom (degrees per shot),
         data-distance (metres to target). Each gun page plugs in its own. */
      (function () {
        var box = document.getElementById('burstSim');
        var stage = document.getElementById('simStage');
        var fireBtn = document.getElementById('simFire');
        var resetBtn = document.getElementById('simReset');
        var bloomEl = document.getElementById('simBloom');
        var shotsEl = document.getElementById('simShots');
        var hitsEl = document.getElementById('simHits');
        var accEl = document.getElementById('simAcc');
        var verdictEl = document.getElementById('simVerdict');
        var logEl = document.getElementById('simLog');
        if (!box || !stage || !fireBtn) return;

        function profile(name, fallback) {
          var v = parseFloat(box.getAttribute('data-' + name));
          return isNaN(v) ? fallback : v;
        }
        var REFIRE_MS = 60000 / profile('rpm', 577);
        var BASE_COF = profile('base-cof', 0.03);   // degrees, ADS standing still
        var BLOOM = profile('bloom', 0.06);          // degrees added per shot, ADS
        var COF_CAP = 1.6;                           // degrees, display cap
        var DIST = profile('distance', 30);          // metres to target
        var timer = null, resetTimer = null;
        var burst = 0, shots = 0, hits = 0;

        function aimPoint() {
          var r = stage.getBoundingClientRect();
          return { x: r.width / 2, y: r.height * 0.42, ppm: r.width / 3 }; // view ≈ 3 m wide at the target
        }
        function setBloom(cof) {
          var pct = Math.min(100, (cof / COF_CAP) * 100);
          bloomEl.style.width = pct + '%';
          bloomEl.className = 'bloom-fill' + (cof > 0.95 ? ' hot' : cof > 0.5 ? ' warm' : '');
        }
        function fireShot() {
          var p = aimPoint();
          var cof = BASE_COF + BLOOM * burst;      // bloom state BEFORE this shot settles
          var radiusM = Math.tan(cof * Math.PI / 180) * DIST;
          var ang = Math.random() * Math.PI * 2;
          var dist = radiusM * Math.sqrt(Math.random()) * p.ppm; // true scale: view is ~3 m wide at the target
          var dx = Math.cos(ang) * dist;
          var dy = Math.sin(ang) * dist - burst * 0.9; // recoil climbs a touch as the burst goes on
          var dot = document.createElement('span');
          dot.className = 'sim-shot';
          var hit = (dx * dx) / (56 * 56) + (dy * dy) / (98 * 98) <= 1; // torso/head ellipse
          if (hit) { dot.classList.add('hit'); hits++; }
          dot.style.left = (p.x + dx) + 'px';
          dot.style.top = (p.y + dy) + 'px';
          stage.appendChild(dot);
          burst++; shots++;
          setBloom(BASE_COF + BLOOM * burst);
          shotsEl.textContent = shots;
          hitsEl.textContent = hits;
          accEl.textContent = Math.round((hits / shots) * 100) + '%';
        }
        function grade(n) {
          if (n < 5) return ['good', '<b>Short &amp; safe</b> — ' + n + ' rounds. Tight group; stretch to 5 for the ideal burst and a faster kill.'];
          if (n === 5) return ['good', '<b>Ideal burst</b> — 5 rounds exactly. That is the rhythm to make automatic.'];
          if (n <= 8) return ['warn', '<b>Tolerable</b> — ' + n + ' rounds. Inside the 6–8 newbie window, but the last shots were already spreading. Aim for 5.'];
          return ['bad', '<b>Too long</b> — ' + n + ' rounds held. Past 8 the cone has grown enough that the extra bullets mostly miss. Release, reset, re-fire.'];
        }
        function startFire(e) {
          if (timer) return;
          if (e && e.preventDefault) e.preventDefault();
          if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
          fireBtn.classList.add('firing');
          fireBtn.textContent = 'Firing…';
          fireShot();
          timer = setInterval(fireShot, REFIRE_MS);
        }
        function stopFire() {
          if (!timer) return;
          clearInterval(timer); timer = null;
          fireBtn.classList.remove('firing');
          fireBtn.textContent = 'Hold to fire';
          if (burst > 0) {
            var g = grade(burst);
            verdictEl.innerHTML = g[1];
            var pip = document.createElement('span');
            pip.className = 'burst-pip ' + g[0];
            pip.textContent = '×' + burst;
            logEl.appendChild(pip);
            burst = 0;
          }
          resetTimer = setTimeout(function () { setBloom(0); }, 260); // cone resets after a short pause
        }
        fireBtn.addEventListener('pointerdown', function (e) {
          try { fireBtn.setPointerCapture(e.pointerId); } catch (err) {}
          startFire(e);
        });
        fireBtn.addEventListener('pointerup', stopFire);
        fireBtn.addEventListener('pointercancel', stopFire);
        fireBtn.addEventListener('keydown', function (e) {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) startFire(e);
        });
        fireBtn.addEventListener('keyup', function (e) {
          if (e.key === ' ' || e.key === 'Enter') stopFire();
        });
        fireBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        resetBtn.addEventListener('click', function () {
          stopFire();
          var dots = stage.querySelectorAll('.sim-shot');
          for (var i = 0; i < dots.length; i++) dots[i].remove();
          shots = 0; hits = 0; burst = 0;
          shotsEl.textContent = '0'; hitsEl.textContent = '0'; accEl.textContent = '—';
          logEl.innerHTML = '';
          verdictEl.textContent = 'Your bursts will be graded here — green at 5 rounds, tolerable up to 8.';
          setBloom(0);
        });
      })();

// Collapsible sections 01-11, copied verbatim from the GD-22S demo
// artifact (v5). Sections 02-11 arrive with class="is-collapsed" in
// the HTML; this wraps each section body in .sec-body, adds the round
// toggle button to the header, and toggles on header click.
/* ---------- collapsible sections 01-11 ----------
         Title (sec-head) always stays visible. Sections arrive with
         class="is-collapsed" in the HTML for 02-11, so the collapsed
         state is correct even before this runs. The body of each
         section is wrapped in .sec-body so the toggle can point at
         it with aria-controls. Widgets inside a section are only
         measured when used (range lab on input, simulator per shot),
         so opening a section later leaves them fully working. */
      (function () {
        var sections = document.querySelectorAll('section[aria-labelledby]');
        for (var i = 0; i < sections.length; i++) {
          (function (sec) {
            var head = sec.querySelector('.sec-head');
            if (!head) return;
            var labelId = sec.getAttribute('aria-labelledby');
            var body = document.createElement('div');
            body.className = 'sec-body';
            body.id = labelId + '-body';
            var kids = [];
            for (var c = 0; c < sec.childNodes.length; c++) kids.push(sec.childNodes[c]);
            for (var k = 0; k < kids.length; k++) {
              if (kids[k] !== head) body.appendChild(kids[k]);
            }
            sec.appendChild(body);

            var numEl = head.querySelector('.num');
            var num = numEl ? numEl.textContent.trim() : '';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sec-toggle';
            btn.setAttribute('aria-controls', body.id);
            btn.innerHTML = '<span class="sec-toggle-icon" aria-hidden="true">▾</span><span class="sr-only">Toggle section ' + num + '</span>';
            head.appendChild(btn);

            function sync() {
              var open = !sec.classList.contains('is-collapsed');
              btn.setAttribute('aria-expanded', open ? 'true' : 'false');
              btn.setAttribute('aria-label', (open ? 'Collapse' : 'Expand') + ' section ' + num);
            }
            function toggle() {
              sec.classList.toggle('is-collapsed');
              sync();
            }
            btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
            head.addEventListener('click', function (e) {
              if (e.target.closest && e.target.closest('button, a')) return;
              toggle();
            });
            sync();
          })(sections[i]);
        }
      })();
