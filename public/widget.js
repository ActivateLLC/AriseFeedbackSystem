/**
 * Arise Cares — Reviews Widget
 * Embed with:
 *   <div id="arise-reviews"></div>
 *   <script src="https://your-domain.com/widget.js" data-limit="6" data-theme="light"></script>
 */
(function () {
  'use strict';

  var SCRIPT = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  var BASE_URL = (function () {
    try { return new URL(SCRIPT.src).origin; } catch (e) { return ''; }
  })();

  var LIMIT  = parseInt(SCRIPT.getAttribute('data-limit')  || '6', 10);
  var THEME  = SCRIPT.getAttribute('data-theme') || 'light';
  var TARGET = SCRIPT.getAttribute('data-target') || 'arise-reviews';

  var COLORS = {
    light: { bg: '#ffffff', card: '#ffffff', cardBorder: '#E8ECF1', text: '#1A1D2E', muted: '#64748B', star: '#F5A623', navy: '#2D3250', shadow: '0 2px 12px rgba(45,50,80,0.08)' },
    dark:  { bg: '#1E2340', card: '#2D3250', cardBorder: '#3D4570', text: '#F0F2FF', muted: '#94A3B8', star: '#F5A623', navy: '#F0F2FF', shadow: '0 2px 12px rgba(0,0,0,0.3)' },
  };
  var C = COLORS[THEME] || COLORS.light;

  /* ── Inject styles ── */
  var styleId = 'arise-widget-styles';
  if (!document.getElementById(styleId)) {
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '#arise-reviews-root *{box-sizing:border-box;margin:0;padding:0;}',
      '#arise-reviews-root{font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;background:' + C.bg + ';padding:40px 16px;}',
      '.ac-widget-header{text-align:center;margin-bottom:32px;}',
      '.ac-widget-logo{height:36px;width:auto;display:block;margin:0 auto 12px;}',
      '.ac-widget-title{font-size:22px;font-weight:800;color:' + C.navy + ';margin-bottom:6px;}',
      '.ac-widget-sub{font-size:14px;color:' + C.muted + ';line-height:1.6;}',
      '.ac-aggregate{display:flex;align-items:center;justify-content:center;gap:10px;margin:14px 0 0;}',
      '.ac-agg-score{font-size:36px;font-weight:800;color:' + C.navy + ';line-height:1;}',
      '.ac-agg-stars{display:flex;gap:2px;}',
      '.ac-agg-star{width:18px;height:18px;fill:' + C.star + ';}',
      '.ac-agg-meta{font-size:13px;color:' + C.muted + ';text-align:left;line-height:1.5;}',
      '.ac-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;max-width:1080px;margin:0 auto;}',
      '.ac-card{background:' + C.card + ';border:1px solid ' + C.cardBorder + ';border-radius:16px;padding:22px;box-shadow:' + C.shadow + ';display:flex;flex-direction:column;gap:12px;transition:transform .15s,box-shadow .15s;}',
      '.ac-card:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(45,50,80,0.12);}',
      '.ac-stars{display:flex;gap:3px;}',
      '.ac-star{width:16px;height:16px;fill:' + C.star + ';}',
      '.ac-comment{font-size:14px;color:' + C.text + ';line-height:1.65;flex:1;}',
      '.ac-comment::before{content:open-quote;font-size:18px;color:' + C.star + ';font-weight:800;line-height:0;vertical-align:-4px;margin-right:2px;}',
      '.ac-comment::after{content:close-quote;font-size:18px;color:' + C.star + ';font-weight:800;line-height:0;vertical-align:-4px;margin-left:2px;}',
      '.ac-meta{display:flex;align-items:center;gap:10px;border-top:1px solid ' + C.cardBorder + ';padding-top:12px;margin-top:auto;}',
      '.ac-avatar{width:32px;height:32px;border-radius:50%;background:#EEF0FF;color:#2D3250;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
      '.ac-author{font-size:13px;font-weight:600;color:' + C.navy + ';}',
      '.ac-date{font-size:12px;color:' + C.muted + ';}',
      '.ac-caregiver{font-size:12px;color:' + C.muted + ';}',
      '.ac-badge{display:inline-flex;align-items:center;gap:4px;background:#EEF0FF;color:#2D3250;border-radius:99px;padding:3px 10px;font-size:11px;font-weight:600;margin-bottom:6px;}',
      '.ac-footer{text-align:center;margin-top:28px;}',
      '.ac-footer-text{font-size:13px;color:' + C.muted + ';margin-bottom:10px;}',
      '.ac-cta{display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border-radius:10px;background:#2D3250;color:#fff;font-size:14px;font-weight:600;text-decoration:none;transition:opacity .15s;}',
      '.ac-cta:hover{opacity:.88;}',
      '.ac-loading{text-align:center;padding:48px;color:' + C.muted + ';font-size:14px;}',
      '.ac-error{text-align:center;padding:48px;color:' + C.muted + ';font-size:14px;}',
      '@media(max-width:600px){.ac-grid{grid-template-columns:1fr;}#arise-reviews-root{padding:28px 12px;}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ── SVG helpers ── */
  function starSVG(cls) {
    return '<svg class="' + cls + '" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l2.582 7.647H22.5l-6.382 4.617 2.382 7.647L12 17.294l-6.5 4.617 2.382-7.647L1.5 9.647H9.418z"/></svg>';
  }

  function starsHtml(n, cls) {
    var h = '';
    for (var i = 0; i < 5; i++) h += starSVG(cls);
    return '<div class="ac-stars">' + h + '</div>';
  }

  function initials(name) {
    if (!name) return '?';
    var p = name.trim().split(/\s+/);
    return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }

  /* ── Mount ── */
  function mount() {
    var container = document.getElementById(TARGET);
    if (!container) {
      container = document.createElement('div');
      container.id = TARGET;
      SCRIPT.parentNode.insertBefore(container, SCRIPT);
    }

    var root = document.createElement('div');
    root.id = 'arise-reviews-root';
    root.innerHTML = '<div class="ac-loading">Loading reviews…</div>';
    container.appendChild(root);

    fetch(BASE_URL + '/api/widget/reviews?limit=' + LIMIT)
      .then(function (r) { return r.json(); })
      .then(function (data) { render(root, data.reviews || []); })
      .catch(function () { root.innerHTML = '<div class="ac-error">Reviews unavailable at this time.</div>'; });
  }

  function render(root, reviews) {
    if (!reviews.length) {
      root.innerHTML = '<div class="ac-error">No reviews yet.</div>';
      return;
    }

    var avg = (reviews.reduce(function (s, r) { return s + r.rating; }, 0) / reviews.length).toFixed(1);

    var cards = reviews.map(function (r) {
      var av = initials(r.author);
      return [
        '<div class="ac-card">',
        '  <div>',
        '    <span class="ac-badge">' + starSVG('ac-star') + ' Verified Client</span>',
        '  </div>',
        '  ' + starsHtml(r.rating, 'ac-star'),
        '  <p class="ac-comment">' + escHtml(r.comment) + '</p>',
        '  <div class="ac-meta">',
        '    <div class="ac-avatar">' + av + '</div>',
        '    <div>',
        '      <div class="ac-author">' + escHtml(r.author) + '</div>',
        r.caregiver ? '      <div class="ac-caregiver">Care by ' + escHtml(r.caregiver) + '</div>' : '',
        r.date      ? '      <div class="ac-date">' + r.date + '</div>' : '',
        '    </div>',
        '  </div>',
        '</div>',
      ].join('\n');
    }).join('');

    root.innerHTML = [
      '<div class="ac-widget-header">',
      '  <img class="ac-widget-logo" src="' + BASE_URL + '/logo.svg" alt="Arise Cares" />',
      '  <div class="ac-widget-title">What Our Clients Say</div>',
      '  <div class="ac-widget-sub">Real feedback from the families we care for every day.</div>',
      '  <div class="ac-aggregate">',
      '    <div class="ac-agg-score">' + avg + '</div>',
      '    <div class="ac-agg-stars">' + [1,2,3,4,5].map(function(){return starSVG('ac-agg-star');}).join('') + '</div>',
      '    <div class="ac-agg-meta"><strong>' + reviews.length + ' reviews</strong><br/>from verified clients</div>',
      '  </div>',
      '</div>',
      '<div class="ac-grid">' + cards + '</div>',
      '<div class="ac-footer">',
      '  <p class="ac-footer-text">If you\'ve had a great experience, we\'d truly appreciate a quick Google review — it helps other families find us.</p>',
      '  <a class="ac-cta" href="#" id="ac-google-cta" target="_blank" rel="noopener">',
      '    <svg width="16" height="16" viewBox="0 0 48 48" fill="none"><path d="M43.6 20H42v-.1H24v8h11.3C33.7 32.6 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-4z" fill="#FFC107"/><path d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00"/><path d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" fill="#4CAF50"/><path d="M43.6 20H42v-.1H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 38.2 44 34 44 24c0-1.3-.1-2.7-.4-4z" fill="#1976D2"/></svg>',
      '    Leave a Google Review',
      '  </a>',
      '</div>',
    ].join('\n');

    // Wire up Google CTA URL if configured
    fetch(BASE_URL + '/api/feedback/config').then(function (r) {
      return r.json();
    }).then(function (cfg) {
      if (cfg && cfg.googleReviewUrl) {
        var el = document.getElementById('ac-google-cta');
        if (el) el.href = cfg.googleReviewUrl;
      }
    }).catch(function () {});
  }

  function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
