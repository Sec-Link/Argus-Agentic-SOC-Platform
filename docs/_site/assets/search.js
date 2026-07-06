(function () {

  /* ─── Theme ──────────────────────────────────────────────────────────────── */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function initTheme() {
    var stored = localStorage.getItem('argus_theme') || 'dark';
    applyTheme(stored);
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    var next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('argus_theme', next);
  }

  window.toggleTheme = toggleTheme;
  initTheme();

  /* ─── Language switcher ──────────────────────────────────────────────────── */

  function switchLang(lang) {
    localStorage.setItem('argus_lang', lang);
    var ref  = typeof PAGE_LANG_REF  !== 'undefined' ? PAGE_LANG_REF  : '';
    var base = typeof SITE_BASEURL   !== 'undefined' ? SITE_BASEURL   : '';
    var dest = (ref && ref.length)
      ? base + '/' + lang + '/' + ref + '/'
      : base + '/';
    window.location.href = dest;
  }

  window.switchLang = switchLang;

  /* ─── TOC ────────────────────────────────────────────────────────────────── */

  function buildToc() {
    var content = document.querySelector('.page-content');
    var panel   = document.getElementById('toc-panel');
    var list    = document.getElementById('toc-list');
    if (!content || !panel || !list) return;

    var headings = Array.prototype.slice.call(content.querySelectorAll('h2, h3'));

    /* Hide panel when there are too few headings to be useful */
    if (headings.length < 2) { panel.hidden = true; return; }
    panel.hidden = false;

    headings.forEach(function (h, i) {
      /* Ensure each heading has an id so we can link to it */
      if (!h.id) {
        var slug = h.textContent
          .toLowerCase()
          .replace(/[\s\/\\]+/g, '-')
          .replace(/[^\w一-鿿-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        h.id = slug || ('heading-' + i);
      }

      var li = document.createElement('li');
      li.className = 'toc-item toc-' + h.tagName.toLowerCase();

      var a = document.createElement('a');
      a.href    = '#' + h.id;
      a.className = 'toc-link';
      a.textContent = h.textContent;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var target = document.getElementById(h.id);
        if (target) {
          var topBarH = 48;
          var y = target.getBoundingClientRect().top + window.pageYOffset - topBarH - 12;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      });

      li.appendChild(a);
      list.appendChild(li);
    });

    /* Scroll spy via IntersectionObserver */
    if (!('IntersectionObserver' in window)) return;

    var allLinks = Array.prototype.slice.call(list.querySelectorAll('.toc-link'));

    function setActive(id) {
      allLinks.forEach(function (l) {
        l.classList.toggle('toc-active', l.getAttribute('href') === '#' + id);
      });
    }

    /* Track the topmost visible heading */
    var visible = [];

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.id;
        if (entry.isIntersecting) {
          if (visible.indexOf(id) === -1) visible.push(id);
        } else {
          visible = visible.filter(function (v) { return v !== id; });
        }
      });
      if (visible.length) setActive(visible[0]);
    }, { rootMargin: '-48px 0px -60% 0px', threshold: 0 });

    headings.forEach(function (h) { obs.observe(h); });
  }

  /* ─── Search ─────────────────────────────────────────────────────────────── */

  function initSearch() {
    var input   = document.getElementById('doc-search');
    var results = document.getElementById('search-results');
    if (!input || !results) return;

    var idx  = [];
    var lang = document.documentElement.lang || 'en';
    var base = typeof SITE_BASEURL !== 'undefined' ? SITE_BASEURL : '';

    fetch(base + '/search-index.json')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) { idx = data; })
      .catch(function () { idx = []; });

    input.addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      results.innerHTML = '';
      if (q.length < 2) { results.hidden = true; return; }

      var hits = idx.filter(function (p) {
        return p.lang === lang &&
          (p.title.toLowerCase().indexOf(q) !== -1 ||
           p.content.toLowerCase().indexOf(q) !== -1);
      }).slice(0, 7);

      if (!hits.length) {
        results.innerHTML = '<li class="sr-empty">No results for &ldquo;' + q + '&rdquo;</li>';
      } else {
        hits.forEach(function (h) {
          var li = document.createElement('li');
          var snippet = h.content.substring(0, 90).replace(/</g, '&lt;');
          li.innerHTML =
            '<a href="' + h.url + '" class="sr-link">' +
              '<span class="sr-title">' + h.title + '</span>' +
              '<span class="sr-snippet">' + snippet + '&#8230;</span>' +
            '</a>';
          results.appendChild(li);
        });
      }
      results.hidden = false;
    });

    document.addEventListener('click', function (e) {
      if (!results.contains(e.target) && e.target !== input) {
        results.hidden = true;
      }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { results.hidden = true; input.value = ''; }
    });
  }

  /* ─── Boot ───────────────────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    initSearch();
    buildToc();
  });

})();
