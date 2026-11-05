/** Single self-contained page. All data is inserted with textContent, never innerHTML. */
export const STATUS_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Softener Status</title>
<style>
  :root {
    --bg: #f4f6f8; --card: #ffffff; --text: #17202a; --muted: #5d6b79; --line: #dde3e9;
    --ok: #1b7f4b; --warn: #b26a00; --bad: #c0262d; --accent: #1b6fd1; --track: #e6ebf0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1419; --card: #182028; --text: #e8edf2; --muted: #93a1af; --line: #2a3541;
      --ok: #4cc38a; --warn: #f0a63a; --bad: #ff6b72; --accent: #5aa7ff; --track: #26323e;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--text);
         font: 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  h1 { font-size: 1.3rem; margin: 0; }
  .sub { color: var(--muted); font-size: .85rem; }
  .banner { border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; font-weight: 600; border: 1px solid; }
  .banner.bad { color: var(--bad); border-color: var(--bad); background: color-mix(in srgb, var(--bad) 12%, var(--card)); }
  .banner.warn { color: var(--warn); border-color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, var(--card)); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
  .card.wide { grid-column: 1 / -1; }
  .label { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  .value { font-size: 1.9rem; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .unit { font-size: .9rem; font-weight: 500; color: var(--muted); margin-left: 4px; }
  .note { color: var(--muted); font-size: .8rem; margin-top: 2px; }
  .bar { height: 10px; border-radius: 6px; background: var(--track); margin-top: 10px; overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--accent); border-radius: 6px; }
  .bar.low > span { background: var(--warn); }
  .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); }
  .alarms { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .alarm { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
  .alarm .state { font-weight: 700; margin-top: 2px; }
  .alarm.active { border-color: var(--bad); }
  footer { color: var(--muted); font-size: .75rem; text-align: center; margin-top: 16px; }
</style>
</head>
<body>
<main>
  <header>
    <h1 id="title">Softener</h1>
    <div class="sub" id="updated">loading…</div>
  </header>
  <div id="banners"></div>
  <div class="grid" id="grid"></div>
  <div class="card wide" style="margin-top:10px">
    <div class="label">Alarms</div>
    <div class="alarms" id="alarms" style="margin-top:8px"></div>
  </div>
  <footer id="foot"></footer>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function num(v, digits) { return v === null || v === undefined ? '–' : (digits ? Number(v).toFixed(digits) : String(Math.round(v))); }
  function ago(min) {
    if (min < 1) return 'just now';
    if (min < 90) return Math.round(min) + ' min ago';
    return (min / 60).toFixed(1) + ' h ago';
  }
  function card(label, value, unit, note, cls) {
    var c = el('div', 'card');
    c.appendChild(el('div', 'label', label));
    var v = el('div', 'value' + (cls ? ' ' + cls : ''), value);
    if (unit) v.appendChild(el('span', 'unit', unit));
    c.appendChild(v);
    if (note) c.appendChild(el('div', 'note', note));
    return c;
  }
  function render(s) {
    $('title').textContent = s.name || 'Softener';
    $('updated').textContent = s.hasData ? 'Updated ' + ago(s.minutesSinceGood) : 'Waiting for first reading…';

    var b = $('banners'); b.textContent = '';
    if (s.offline) {
      b.appendChild(el('div', 'banner bad', 'OFFLINE – no good data for ' + ago(s.minutesSinceGood).replace(' ago','') + '. Flow alarms will NOT be reported until this recovers.'));
    } else if (s.hasData && !s.online) {
      b.appendChild(el('div', 'banner warn', 'The softener is not reporting to the HydroLink cloud.'));
    }
    s.alarms.forEach(function (a) {
      if (a.active) b.appendChild(el('div', 'banner bad', 'ALARM: ' + a.label + (s.testActive && a.id === 'flow-alarm' ? ' (test)' : '')));
    });

    var g = $('grid'); g.textContent = '';
    var salt = card('Salt level', num(s.saltPercent), '%', s.outOfSaltDays !== null ? 'About ' + s.outOfSaltDays + ' days until empty' : '', s.lowSalt ? 'warn' : '');
    if (s.saltPercent !== null) {
      var bar = el('div', 'bar' + (s.lowSalt ? ' low' : ''));
      var fill = el('span'); fill.style.width = Math.max(0, Math.min(100, s.saltPercent)) + '%';
      bar.appendChild(fill); salt.appendChild(bar);
    }
    salt.classList.add('wide'); g.appendChild(salt);
    g.appendChild(card('Used today', num(s.gallonsToday), 'gal', s.avgDailyGallons !== null ? 'Daily average ' + num(s.avgDailyGallons) + ' gal' : ''));
    g.appendChild(card('Flow now', num(s.flowGpm, 1), 'gpm'));
    g.appendChild(card('Treated water left', num(s.treatedWaterAvailGallons), 'gal', 'Before the next recharge'));
    g.appendChild(card('Recharge', s.recharging ? 'Running' : 'Idle', '', s.daysSinceRegen !== null ? 'Last recharge ' + s.daysSinceRegen + ' day' + (s.daysSinceRegen === 1 ? '' : 's') + ' ago' : '', s.recharging ? 'warn' : ''));

    var al = $('alarms'); al.textContent = '';
    s.alarms.forEach(function (a) {
      var d = el('div', 'alarm' + (a.active ? ' active' : ''));
      d.appendChild(el('div', 'label', a.label));
      d.appendChild(el('div', 'state ' + (a.active ? 'bad' : 'ok'), a.active ? 'ALARM' : 'OK'));
      al.appendChild(d);
    });

    var f = [s.model, s.firmware ? 'fw ' + s.firmware : '', s.serial, s.signalDbm !== null ? s.signalDbm + ' dBm' : ''].filter(Boolean);
    $('foot').textContent = f.join(' · ');
  }
  function load() {
    fetch('status.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        if (!j.softeners.length) { $('updated').textContent = 'No softener found yet'; return; }
        render(j.softeners[0]);
      })
      .catch(function () { $('updated').textContent = 'Cannot reach the plugin – retrying…'; });
  }
  load(); setInterval(load, 30000);
})();
</script>
</body>
</html>
`;
