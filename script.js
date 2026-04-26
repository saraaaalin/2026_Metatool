/**
 * Portable Attention Box — client-side logic
 * - Hash-based “pages” (no server)
 * - localStorage persistence for attention records
 * - Seeded pseudo-random point clouds (placeholder for real CV)
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Storage key + record shape
  // Each record: { id, date, focus, mood, lighting, notes, photoDataUrl, cloudSeed }
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = 'portableAttentionBox_records_v1';

  /** Read all records from localStorage (or []). */
  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('loadRecords failed', e);
      return [];
    }
  }

  /** Persist the full list. */
  function saveRecords(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  // ---------------------------------------------------------------------------
  // Seeded random — same seed ⇒ same point cloud (archive thumbnails match)
  // ---------------------------------------------------------------------------
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Mulberry32 PRNG factory. */
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Draw a simulated “desk object” point cloud: density clusters + sparse field points.
   * TouchDesigner-ish: black field, white / blue-white pixels.
   */
  function drawPointCloud(canvas, seed) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rand = mulberry32(hashString(String(seed)) || 1);

    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, w, h);

    const numClusters = 4 + Math.floor(rand() * 5);
    const clusters = [];
    for (let i = 0; i < numClusters; i++) {
      clusters.push({
        x: rand() * w,
        y: rand() * h,
        r: Math.min(w, h) * (0.08 + rand() * 0.18),
        weight: 0.4 + rand() * 0.8,
      });
    }

    const numPoints = Math.floor(w * h * 0.035 + rand() * (w * h * 0.02));

    for (let i = 0; i < numPoints; i++) {
      let x;
      let y;
      if (rand() < 0.82) {
        const c = clusters[Math.floor(rand() * numClusters)];
        const ang = rand() * Math.PI * 2;
        const dist = Math.sqrt(rand()) * c.r * (0.6 + rand() * 0.8);
        x = c.x + Math.cos(ang) * dist;
        y = c.y + Math.sin(ang) * dist;
      } else {
        x = rand() * w;
        y = rand() * h;
      }

      x = Math.max(0, Math.min(w - 1, x));
      y = Math.max(0, Math.min(h - 1, y));

      const cool = rand() > 0.62;
      ctx.fillStyle = cool
        ? 'rgba(195, 225, 255, 0.9)'
        : 'rgba(250, 250, 252, 0.82)';
      const s = rand() < 0.88 ? 1 : 2;
      ctx.fillRect(Math.floor(x), Math.floor(y), s, s);
    }

    // Subtle grid hint (spatial reference)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const step = 32;
    for (let gx = 0; gx <= w; gx += step) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy <= h; gy += step) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------------------
  // Routing: #home | #new | #archive | #recall
  // ---------------------------------------------------------------------------
  function getPageFromHash() {
    const h = (window.location.hash || '#home').slice(1).toLowerCase();
    if (['home', 'new', 'archive', 'recall'].includes(h)) return h;
    return 'home';
  }

  function showPage(id) {
    document.querySelectorAll('.page').forEach(function (el) {
      el.classList.toggle('page--active', el.id === 'page-' + id);
    });
    document.querySelectorAll('.site-nav a[data-nav]').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-nav') === id);
    });
    if (id === 'archive') renderArchive();
    if (id === 'recall') {
      /* leave recall results until user searches */
    }
  }

  function navigateTo(id) {
    window.location.hash = id;
  }

  // ---------------------------------------------------------------------------
  // New entry: photo + generate + save
  // ---------------------------------------------------------------------------
  let currentPhotoDataUrl = '';
  let currentCloudSeed = '';

  function setSaveEnabled(ok) {
    const btn = document.getElementById('btn-save');
    if (btn) btn.disabled = !ok;
  }

  function onGenerate() {
    const fileInput = document.getElementById('photo-input');
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      alert('Please choose a desk photo first.');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (ev) {
      currentPhotoDataUrl = ev.target.result;
      const img = document.getElementById('preview-photo');
      img.src = currentPhotoDataUrl;

      currentCloudSeed = 'cloud-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const canvas = document.getElementById('cloud-canvas-main');
      drawPointCloud(canvas, currentCloudSeed);

      document.getElementById('record-preview').classList.remove('hidden');
      setSaveEnabled(true);
    };
    reader.readAsDataURL(file);
  }

  function onSave() {
    const date = document.getElementById('entry-date').value;
    const focus = parseInt(document.getElementById('entry-focus').value, 10);
    const mood = document.getElementById('entry-mood').value.trim();
    const lighting = document.getElementById('entry-lighting').value.trim();
    const notes = document.getElementById('entry-notes').value.trim();

    if (!date || Number.isNaN(focus)) {
      alert('Date and focus level are required.');
      return;
    }
    if (!currentPhotoDataUrl || !currentCloudSeed) {
      alert('Generate a spatial record first.');
      return;
    }

    const record = {
      id: 'rec-' + Date.now(),
      date: date,
      focus: Math.max(0, Math.min(100, focus)),
      mood: mood,
      lighting: lighting,
      notes: notes,
      photoDataUrl: currentPhotoDataUrl,
      cloudSeed: currentCloudSeed,
    };

    const all = loadRecords();
    all.unshift(record);
    saveRecords(all);

    alert('Saved to archive.');
    document.getElementById('entry-form').reset();
    document.getElementById('entry-date').value = defaultDateString();
    document.getElementById('record-preview').classList.add('hidden');
    currentPhotoDataUrl = '';
    currentCloudSeed = '';
    setSaveEnabled(false);
    navigateTo('archive');
  }

  function defaultDateString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // ---------------------------------------------------------------------------
  // Archive grid
  // ---------------------------------------------------------------------------
  function renderArchive() {
    const records = loadRecords();
    const grid = document.getElementById('archive-grid');
    const empty = document.getElementById('archive-empty');
    grid.innerHTML = '';

    if (records.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    records.forEach(function (rec) {
      const card = document.createElement('article');
      card.className = 'record-card';
      card.innerHTML =
        '<div class="record-card__meta">' +
        '<dl>' +
        '<dt>Date</dt><dd>' +
        escapeHtml(rec.date) +
        '</dd>' +
        '<dt>Focus</dt><dd>' +
        escapeHtml(String(rec.focus)) +
        '%</dd>' +
        '<dt>Mood</dt><dd>' +
        escapeHtml(rec.mood || '—') +
        '</dd>' +
        '<dt>Lighting</dt><dd>' +
        escapeHtml(rec.lighting || '—') +
        '</dd>' +
        '</dl></div>' +
        '<div class="record-card__split">' +
        '<div class="record-card__thumb"><img alt="" /></div>' +
        '<div class="record-card__thumb"><canvas width="160" height="160" aria-hidden="true"></canvas></div>' +
        '</div>' +
        '<p class="record-card__notes"></p>' +
        '<div class="record-card__actions">' +
        '<button type="button" class="btn btn--small btn-remove" data-id="' +
        escapeHtml(rec.id) +
        '">Remove</button>' +
        '</div>';

      const img = card.querySelector('img');
      img.src = rec.photoDataUrl;
      img.alt = 'Desk photo from ' + rec.date;

      const noteEl = card.querySelector('.record-card__notes');
      noteEl.textContent = rec.notes || '—';

      const cnv = card.querySelector('canvas');
      drawPointCloud(cnv, rec.cloudSeed);

      card.querySelector('.btn-remove').addEventListener('click', function () {
        if (confirm('Remove this record from the local archive?')) {
          const next = loadRecords().filter(function (r) {
            return r.id !== rec.id;
          });
          saveRecords(next);
          renderArchive();
        }
      });

      grid.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // Recall: closest focus levels
  // ---------------------------------------------------------------------------
  function runRecall() {
    const input = document.getElementById('recall-target');
    const target = parseInt(input.value, 10);
    const empty = document.getElementById('recall-empty');
    const grid = document.getElementById('recall-grid');

    if (Number.isNaN(target) || target < 0 || target > 100) {
      alert('Enter a desired attention level between 0 and 100.');
      return;
    }

    const records = loadRecords();
    if (records.length === 0) {
      empty.textContent = 'No records in the archive yet.';
      empty.classList.remove('hidden');
      grid.classList.add('hidden');
      grid.innerHTML = '';
      return;
    }

    const scored = records.map(function (r) {
      return {
        rec: r,
        distance: Math.abs(r.focus - target),
      };
    });
    scored.sort(function (a, b) {
      return a.distance - b.distance || b.rec.date.localeCompare(a.rec.date);
    });

    empty.classList.add('hidden');
    grid.classList.remove('hidden');
    grid.innerHTML = '';

    scored.forEach(function (item) {
      const rec = item.rec;
      const card = document.createElement('article');
      card.className = 'record-card';
      card.innerHTML =
        '<div class="record-card__meta">' +
        '<dl>' +
        '<dt>Date</dt><dd>' +
        escapeHtml(rec.date) +
        '</dd>' +
        '<dt>Focus</dt><dd>' +
        escapeHtml(String(rec.focus)) +
        '%</dd>' +
        '<dt>Mood</dt><dd>' +
        escapeHtml(rec.mood || '—') +
        '</dd>' +
        '<dt>Lighting</dt><dd>' +
        escapeHtml(rec.lighting || '—') +
        '</dd>' +
        '</dl>' +
        '<span class="badge-distance">Δ from target: ' +
        item.distance +
        '%</span></div>' +
        '<div class="record-card__split">' +
        '<div class="record-card__thumb"><img alt="" /></div>' +
        '<div class="record-card__thumb"><canvas width="160" height="160" aria-hidden="true"></canvas></div>' +
        '</div>' +
        '<p class="record-card__notes"></p>';

      const img = card.querySelector('img');
      img.src = rec.photoDataUrl;
      img.alt = 'Desk photo from ' + rec.date;

      card.querySelector('.record-card__notes').textContent = rec.notes || '—';

      drawPointCloud(card.querySelector('canvas'), rec.cloudSeed);

      grid.appendChild(card);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Init: listeners + default date
  // ---------------------------------------------------------------------------
  function init() {
    const dateEl = document.getElementById('entry-date');
    if (dateEl && !dateEl.value) dateEl.value = defaultDateString();

    document.getElementById('btn-generate').addEventListener('click', onGenerate);
    document.getElementById('btn-save').addEventListener('click', onSave);
    document.getElementById('btn-recall').addEventListener('click', runRecall);

    document.querySelectorAll('a[data-nav]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        const id = a.getAttribute('data-nav');
        navigateTo(id);
      });
    });

    window.addEventListener('hashchange', function () {
      showPage(getPageFromHash());
    });

    showPage(getPageFromHash());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
