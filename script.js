/**
 * Portable Attention Box — dual-shell navigation + local prototype state
 * Desktop ≥769px · Mobile ≤768px
 */
(function () {
  "use strict";

  var STORAGE_KEY = "pab_records_v1";

  var DESKTOP_RECORDS = [
    { id: "041", date: "Apr 12, 2025", time: "9:41am", focus: 72, mood: "Calm", light: "Soft", objects: 5 },
    { id: "040", date: "Apr 11, 2025", time: "8:15am", focus: 88, mood: "Focused", light: "Bright", objects: 5 },
    { id: "039", date: "Apr 9, 2025", time: "2:02pm", focus: 45, mood: "Restless", light: "Artificial", objects: 4 },
    { id: "038", date: "Apr 7, 2025", time: "10:30am", focus: 61, mood: "Alert", light: "Soft", objects: 6 },
    { id: "037", date: "Apr 5, 2025", time: "7:55am", focus: 79, mood: "Calm", light: "Bright", objects: 5 },
    { id: "036", date: "Apr 3, 2025", time: "11:20am", focus: 55, mood: "Tired", light: "Dim", objects: 3 },
  ];

  var EARLIER_MOCKS = [
    {
      id: "earlier-a",
      recordCode: "035",
      displayId: "PAB-2025-0328-035",
      date: "Mar 28, 2025",
      time: "4:12pm",
      focus: 52,
      mood: "Calm",
      light: "Dim",
      objects: 4,
      notes: "Earlier imported record (mock).",
      photoDataUrl: null,
      duration: "1h 05m",
      createdAt: 0,
    },
    {
      id: "earlier-b",
      recordCode: "034",
      displayId: "PAB-2025-0315-034",
      date: "Mar 15, 2025",
      time: "11:30am",
      focus: 67,
      mood: "Focused",
      light: "Soft",
      objects: 5,
      notes: "Earlier imported record (mock).",
      photoDataUrl: null,
      duration: "3h 10m",
      createdAt: 0,
    },
  ];

  var deskCameraStream = null;

  var state = {
    mobileStack: [],
    uploadedImage: null,
    focusLevel: 72,
    selectedMood: "Calm",
    selectedLighting: "Soft",
    recallMood: "Any",
    draftRecordKey: null,
    showEarlierMobile: false,
    selectedRecord: null,
    deskEntryStep: 1,
  };

  function seedInitialRecords() {
    var now = Date.now();
    return DESKTOP_RECORDS.map(function (r, idx) {
      return {
        id: "seed-" + r.id,
        recordCode: r.id,
        displayId: "PAB-2025-0" + r.id,
        date: r.date,
        time: r.time,
        focus: r.focus,
        mood: r.mood,
        light: r.light,
        objects: r.objects != null ? r.objects : 5,
        notes:
          "Morning session. " + r.mood + " mood, " + r.light + " light — logged as record " + r.id + ".",
        photoDataUrl: null,
        duration: "2h 14m",
        createdAt: now - idx * 86400000,
      };
    });
  }

  function loadRecordsFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var initial = seedInitialRecords();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        return initial;
      }
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : seedInitialRecords();
    } catch (e) {
      return seedInitialRecords();
    }
  }

  function saveRecordsToStorage(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  }

  function getAllRecords() {
    return loadRecordsFromStorage();
  }

  function getRecordsForDisplayMobile() {
    var base = getAllRecords().slice();
    base.sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return state.showEarlierMobile ? base.concat(EARLIER_MOCKS) : base;
  }

  function findRecordById(id) {
    var pool = getRecordsForDisplayMobile();
    var i;
    for (i = 0; i < pool.length; i += 1) {
      if (pool[i].id === id) return pool[i];
    }
    var desk = getAllRecords();
    for (i = 0; i < desk.length; i += 1) {
      if (desk[i].id === id) return desk[i];
    }
    return null;
  }

  function findRecordByIdDesk(id) {
    var all = getAllRecords();
    var i;
    for (i = 0; i < all.length; i += 1) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    var i;
    for (i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      var t = (seed += 0x6d2b79f5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawPointCloudMetatool(canvas, seed, density) {
    var w = canvas.width;
    var h = canvas.height;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var rand = mulberry32(hashString(String(seed)) || 1);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(12,12,12,0.05)";
    ctx.lineWidth = 0.5;
    var y;
    for (y = 0; y <= h; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    var x;
    for (x = 0; x <= w; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    var pts = [];
    var cx = w * 0.5;
    var cy = h * 0.5;
    var i;
    for (i = 0; i < density; i += 1) {
      var a = rand() * Math.PI * 2;
      var rad = Math.pow(rand(), 0.6) * Math.min(w, h) * 0.42;
      pts.push({
        x: cx + Math.cos(a) * rad * (0.6 + rand() * 0.8),
        y: cy + Math.sin(a) * rad * 0.7,
        s: 0.8 + rand() * 2.5,
        o: 0.15 + rand() * 0.7,
      });
    }
    [[0.25, 0.38], [0.55, 0.3], [0.74, 0.52], [0.38, 0.65], [0.62, 0.68]].forEach(function (pair) {
      var j;
      for (j = 0; j < 14; j += 1) {
        pts.push({
          x: pair[0] * w + (rand() - 0.5) * 36,
          y: pair[1] * h + (rand() - 0.5) * 28,
          s: 1 + rand() * 3,
          o: 0.3 + rand() * 0.65,
        });
      }
    });

    for (i = 0; i < Math.min(50, pts.length); i += 1) {
      var j;
      for (j = i + 1; j < Math.min(i + 3, pts.length); j += 1) {
        var p = pts[i];
        var q = pts[j];
        var d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < 60) {
          ctx.strokeStyle = "rgba(12,12,12,0.09)";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
    }

    pts.forEach(function (p) {
      ctx.fillStyle = "rgba(12,12,12," + p.o + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawPointCloudPortable(canvas, seed, density) {
    var w = canvas.width;
    var h = canvas.height;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var rand = mulberry32(hashString(String(seed)) || 1);
    ctx.clearRect(0, 0, w, h);

    var yi;
    for (yi = 0; yi <= Math.floor(h / 20); yi += 1) {
      ctx.strokeStyle = "rgba(12,12,12,0.06)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yi * 20);
      ctx.lineTo(w, yi * 20);
      ctx.stroke();
    }
    var xi;
    for (xi = 0; xi <= Math.floor(w / 20); xi += 1) {
      ctx.beginPath();
      ctx.moveTo(xi * 20, 0);
      ctx.lineTo(xi * 20, h);
      ctx.stroke();
    }

    var pts = [];
    var cx = w * 0.5;
    var cy = h * 0.45;
    var i;
    for (i = 0; i < density; i += 1) {
      var angle = rand() * Math.PI * 2;
      var spread = rand();
      var radius = Math.pow(spread, 0.5) * Math.min(w, h) * 0.44;
      pts.push({
        x: cx + Math.cos(angle) * radius * (0.5 + rand() * 0.5),
        y: cy + Math.sin(angle) * radius * 0.65,
        s: 0.8 + rand() * 2.2,
        o: 0.15 + rand() * 0.75,
      });
    }
    [[0.28, 0.38], [0.55, 0.32], [0.72, 0.5], [0.38, 0.62], [0.6, 0.65]].forEach(function (pair) {
      var j;
      for (j = 0; j < 12; j += 1) {
        pts.push({
          x: pair[0] * w + (rand() - 0.5) * 28,
          y: pair[1] * h + (rand() - 0.5) * 20,
          s: 1 + rand() * 2.5,
          o: 0.4 + rand() * 0.55,
        });
      }
    });

    for (i = 0; i < Math.min(40, pts.length); i += 1) {
      var k;
      for (k = i + 1; k < Math.min(i + 3, pts.length); k += 1) {
        var p = pts[i];
        var q = pts[k];
        var dist = Math.hypot(q.x - p.x, q.y - p.y);
        if (dist < 55) {
          ctx.strokeStyle = "rgba(12,12,12,0.1)";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
      }
    }

    pts.forEach(function (p) {
      ctx.fillStyle = "rgba(12,12,12," + p.o + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderHalftone(container, width, height) {
    if (!container) return;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("class", "halftone-bg");
    var rows = Math.floor(height / 10);
    var cols = Math.floor(width / 10);
    var cx2 = width / 2;
    var cy2 = height / 2;
    var maxD = Math.hypot(cx2, cy2);
    var r;
    var c;
    for (r = 0; r < rows; r += 1) {
      for (c = 0; c < cols; c += 1) {
        var x = c * 10 + 5;
        var y = r * 10 + 5;
        var d = Math.hypot(x - cx2, y - cy2);
        var sz = 0.4 + (d / maxD) * 1.0;
        var circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", String(y));
        circle.setAttribute("r", String(sz));
        circle.setAttribute("fill", "rgba(12,12,12,0.25)");
        svg.appendChild(circle);
      }
    }
    container.innerHTML = "";
    container.appendChild(svg);
  }

  function syncRangeVisual(range, fillEl, thumbEl, pct) {
    var v = pct != null ? Number(pct) : Number(range.value);
    var p = Math.max(0, Math.min(100, v));
    if (fillEl) fillEl.style.width = p + "%";
    if (thumbEl) thumbEl.style.left = p + "%";
  }

  function getDeskRecallMoodFilter() {
    var g = document.querySelector('[data-desk-chip-group="recall-mood"]');
    var on = g && g.querySelector("button.is-on");
    return on ? on.textContent.trim() : "Any";
  }

  function getDeskRecallLightFilter() {
    var g = document.querySelector('[data-desk-chip-group="recall-light"]');
    var on = g && g.querySelector("button.is-on");
    return on ? on.textContent.trim() : "Bright";
  }

  function computeDeskMatches() {
    var range = document.getElementById("desk-recall-focus-range");
    var target = range ? Number(range.value) : 85;
    var moodF = getDeskRecallMoodFilter();
    var lightF = getDeskRecallLightFilter();
    var all = getAllRecords();
    var scored = all.map(function (r) {
      var pen = Math.abs(r.focus - target) * 1.15;
      if (moodF !== "Any" && r.mood !== moodF) pen += 22;
      if (r.light !== lightF) pen += 14;
      var match = Math.max(0, Math.min(100, Math.round(100 - pen)));
      return { record: r, match: match, dist: Math.abs(r.focus - target) };
    });
    scored.sort(function (a, b) {
      return b.match - a.match || a.dist - b.dist;
    });
    var top = scored.slice(0, 8);
    var j;
    for (j = 0; j < top.length; j += 1) {
      top[j].best = j === 0;
    }
    return top;
  }

  function computeMobileMatches() {
    var range = document.getElementById("mobile-recall-focus-range");
    var target = range ? Number(range.value) : 85;
    var moodF = state.recallMood || "Any";
    var all = getAllRecords();
    var scored = all.map(function (r) {
      var pen = Math.abs(r.focus - target) * 1.05;
      if (moodF !== "Any" && r.mood !== moodF) pen += 18;
      var match = Math.max(0, Math.min(100, Math.round(100 - pen)));
      return { record: r, match: match, dist: Math.abs(r.focus - target) };
    });
    scored.sort(function (a, b) {
      return b.match - a.match || a.dist - b.dist;
    });
    var top = scored.slice(0, 8);
    var j;
    for (j = 0; j < top.length; j += 1) {
      top[j].best = j === 0;
    }
    return top;
  }

  function updateDeskArchiveMeta() {
    var rows = getAllRecords();
    var n = rows.length;
    var avg = n ? Math.round(rows.reduce(function (s, r) {
      return s + r.focus;
    }, 0) / n) : 0;
    var c = document.getElementById("desk-archive-count");
    var a = document.getElementById("desk-archive-avg-focus");
    if (c) c.textContent = String(n);
    if (a) a.textContent = String(avg);
  }

  function buildDeskArchiveRows() {
    var host = document.getElementById("desk-archive-rows");
    if (!host) return;
    host.innerHTML = "";
    var list = getAllRecords().slice();
    list.sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    list.forEach(function (r, idx) {
      var row = document.createElement("div");
      row.className = "desk-table-row";
      row.setAttribute("data-record-id", r.id);
      var photoCell = r.photoDataUrl
        ? '<div class="desk-thumb-cell"><img src="' +
          r.photoDataUrl +
          '" alt="" style="width:100%;height:100%;object-fit:cover;display:block" /></div>'
        : '<div class="desk-thumb-cell"><svg viewBox="0 0 60 52" width="60" height="52"><use href="#desk-thumb" /></svg></div>';
      row.innerHTML =
        photoCell +
        '<div class="desk-thumb-cell"><canvas width="60" height="52" data-pc-m="desk-arch-' +
        idx +
        "-" +
        r.id +
        '" data-den="28"></canvas></div>' +
        '<div><div class="desk-table-mini">' +
        r.displayId +
        '</div><div class="desk-table-mini"><small>' +
        r.objects +
        " objects detected</small></div></div>" +
        '<div style="font-family:var(--mono);font-size:10px;color:var(--ink);line-height:1.5">' +
        r.date +
        '<br/><span style="color:var(--gray3)">' +
        r.time +
        "</span></div>" +
        '<div><div style="font-family:var(--mono);font-size:14px;font-weight:500;margin-bottom:3px">' +
        r.focus +
        '%</div><div class="desk-focus-bar"><i style="width:' +
        r.focus +
        '%"></i></div></div>' +
        '<div style="font-family:var(--mono);font-size:10px;color:var(--gray3)">' +
        r.mood +
        "</div>" +
        '<div style="font-family:var(--mono);font-size:10px;color:var(--gray3)">' +
        r.light +
        '</div><div><button type="button" class="desk-cell-btn">View →</button></div>';
      host.appendChild(row);
    });
    host.querySelectorAll("canvas[data-pc-m]").forEach(function (cv) {
      var den = parseInt(cv.getAttribute("data-den"), 10) || 28;
      drawPointCloudMetatool(cv, cv.getAttribute("data-pc-m"), den);
    });

    host.onclick = function (e) {
      var row = e.target.closest(".desk-table-row");
      if (!row || !host.contains(row)) return;
      var id = row.getAttribute("data-record-id");
      var rec = findRecordByIdDesk(id);
      if (rec) openDeskDetail(rec);
    };

    updateDeskArchiveMeta();
  }

  function buildDeskRecallResults(matches) {
    var host = document.getElementById("desk-recall-results");
    if (!host) return;
    host.innerHTML = "";
    var countEl = document.getElementById("desk-recall-result-count");
    if (countEl) countEl.textContent = matches.length ? String(matches.length) + " " : "0 ";
    matches.forEach(function (row, i) {
      var r = row.record;
      var card = document.createElement("div");
      card.className = "desk-result-card" + (row.best ? " is-best" : "");
      card.setAttribute("data-record-id", r.id);
      card.innerHTML =
        '<div class="desk-thumb-cell" style="width:72px;height:60px"><svg viewBox="0 0 60 52" width="72" height="60"><use href="#desk-thumb" /></svg></div>' +
        '<div class="desk-thumb-cell" style="width:72px;height:60px;background:var(--paper2)"><canvas width="72" height="60" data-pc-m="desk-rec-' +
        i +
        "-" +
        r.id +
        '" data-den="32"></canvas></div>' +
        "<div>" +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
        '<span style="font-family:var(--mono);font-size:12px;font-weight:500">' +
        r.date +
        " — " +
        r.focus +
        "% focus</span>" +
        (row.best ? '<span class="desk-badge">Best match</span>' : "") +
        "</div>" +
        '<div style="font-family:var(--mono);font-size:9px;color:var(--gray3);letter-spacing:0.06em;margin-bottom:8px">' +
        r.mood +
        " · " +
        r.light +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;height:2px;background:var(--gray1);position:relative">' +
        '<div style="position:absolute;left:0;top:0;height:100%;width:' +
        row.match +
        '%;background:var(--ink)"></div></div>' +
        '<span style="font-family:var(--mono);font-size:9px;letter-spacing:0.08em;color:var(--ink);white-space:nowrap">' +
        row.match +
        "% match</span></div></div>" +
        '<div class="desk-result-actions"><button type="button">Recreate →</button></div>';
      host.appendChild(card);
    });
    host.querySelectorAll("canvas[data-pc-m]").forEach(function (cv) {
      var den = parseInt(cv.getAttribute("data-den"), 10) || 32;
      drawPointCloudMetatool(cv, cv.getAttribute("data-pc-m"), den);
    });

    host.onclick = function (e) {
      var card = e.target.closest(".desk-result-card");
      if (!card || !host.contains(card)) return;
      if (e.target.closest(".desk-result-actions")) {
        e.stopPropagation();
        window.location.hash = "new-entry";
        return;
      }
      var id = card.getAttribute("data-record-id");
      var rec = findRecordByIdDesk(id);
      if (rec) openDeskDetail(rec);
    };
  }

  function findDeskMatchesAndRender() {
    buildDeskRecallResults(computeDeskMatches());
  }

  function buildMobileArchiveList() {
    var host = document.getElementById("mobile-archive-list");
    if (!host) return;
    host.innerHTML = "";
    var records = getRecordsForDisplayMobile();
    var countEl = document.getElementById("mobile-archive-count");
    if (countEl) countEl.textContent = String(records.length);
    records.forEach(function (r, i) {
      var card = document.createElement("article");
      card.className = "archive-card";
      card.setAttribute("data-record-id", r.id);
      var thumbL =
        r.photoDataUrl != null
          ? '<div class="thumb-box"><img src="' +
            r.photoDataUrl +
            '" alt="" style="width:100%;height:100%;object-fit:cover;display:block" /></div>'
          : '<div class="thumb-box"><svg viewBox="0 0 174 200" width="56" height="56"><use href="#desk-photo-svg" /></svg></div>';
      card.innerHTML =
        thumbL +
        '<div class="thumb-box"><canvas width="56" height="56" data-pc-p="m-arch-' +
        i +
        "-" +
        r.id +
        '" data-den="40"></canvas></div>' +
        '<div class="archive-meta">' +
        '<div class="date">' +
        r.date +
        "</div><div>" +
        r.time +
        '</div><div style="margin:3px 0"><span class="focus-pill">' +
        r.focus +
        '% focus</span></div><div>' +
        r.mood +
        " · " +
        r.light +
        "</div></div>";
      host.appendChild(card);
      card.addEventListener("click", function () {
        state.selectedRecord = r;
        navigateMobileForward("detail");
      });
    });
    host.querySelectorAll("canvas[data-pc-p]").forEach(function (cv) {
      var den = parseInt(cv.getAttribute("data-den"), 10) || 40;
      drawPointCloudPortable(cv, cv.getAttribute("data-pc-p"), den);
    });
  }

  function buildMobileRecallList(matches) {
    var host = document.getElementById("mobile-recall-list");
    if (!host) return;
    host.innerHTML = "";
    var countEl = document.getElementById("mobile-recall-count");
    if (!matches || !matches.length) {
      if (countEl) countEl.textContent = "0";
      return;
    }
    if (countEl) countEl.textContent = String(matches.length);
    matches.forEach(function (row, i) {
      var r = row.record;
      var el = document.createElement("div");
      el.className = "recall-card";
      el.setAttribute("data-record-id", r.id);
      el.innerHTML =
        '<div style="display:grid;grid-template-columns:48px 48px 1fr;gap:10px;align-items:start">' +
        '<div class="thumb-box" style="width:48px;height:48px"><svg viewBox="0 0 174 200" width="48" height="48"><use href="#desk-photo-svg" /></svg></div>' +
        '<div class="thumb-box" style="width:48px;height:48px"><canvas width="48" height="48" data-pc-p="m-rec-' +
        i +
        "-" +
        r.id +
        '" data-den="30"></canvas></div>' +
        "<div>" +
        '<div style="font-size:10px;font-weight:500;color:var(--ink);margin-bottom:2px">' +
        r.date +
        " — " +
        r.focus +
        "% focus</div>" +
        '<div style="font-size:8px;color:var(--gray3);letter-spacing:0.06em;margin-bottom:5px">' +
        r.mood +
        " · " +
        r.light +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<div class="recall-match-bar" style="flex:1">' +
        '<div class="recall-match-fill" style="width:' +
        row.match +
        '%"></div></div>' +
        '<span style="font-size:8px;font-weight:500;letter-spacing:0.08em;white-space:nowrap">' +
        row.match +
        "% match</span></div></div></div>";
      host.appendChild(el);
      el.addEventListener("click", function () {
        state.selectedRecord = r;
        navigateMobileForward("detail");
      });
    });
    host.querySelectorAll("canvas[data-pc-p]").forEach(function (cv) {
      var den = parseInt(cv.getAttribute("data-den"), 10) || 30;
      drawPointCloudPortable(cv, cv.getAttribute("data-pc-p"), den);
    });
  }

  function openDeskDetail(rec) {
    if (!rec) return;
    state.selectedRecord = rec;
    var ov = document.getElementById("desk-detail-overlay");
    if (!ov) return;
    var code = document.getElementById("desk-detail-code");
    var head = document.getElementById("desk-detail-heading");
    var notes = document.getElementById("desk-detail-notes");
    var img = document.getElementById("desk-detail-photo");
    var fb = document.getElementById("desk-detail-photo-fallback");
    if (code) code.textContent = rec.displayId || rec.recordCode;
    if (head) head.textContent = rec.date + " — " + rec.time;
    if (notes) notes.textContent = rec.notes || "";
    if (rec.photoDataUrl && img && fb) {
      img.src = rec.photoDataUrl;
      img.classList.remove("hidden");
      fb.classList.add("hidden");
    } else if (img && fb) {
      img.classList.add("hidden");
      fb.classList.remove("hidden");
    }
    var sf = document.getElementById("desk-detail-stat-focus");
    var sm = document.getElementById("desk-detail-stat-mood");
    var sl = document.getElementById("desk-detail-stat-light");
    var so = document.getElementById("desk-detail-stat-objects");
    if (sf) sf.textContent = rec.focus + "%";
    if (sm) sm.textContent = rec.mood;
    if (sl) sl.textContent = rec.light;
    if (so) so.textContent = String(rec.objects != null ? rec.objects : "—");
    var cv = document.getElementById("canvas-desk-detail-pc");
    if (cv) drawPointCloudMetatool(cv, "desk-detail-" + rec.id, 72);
    ov.classList.add("is-open");
    ov.setAttribute("aria-hidden", "false");
  }

  function closeDeskDetail() {
    var ov = document.getElementById("desk-detail-overlay");
    if (!ov) return;
    ov.classList.remove("is-open");
    ov.setAttribute("aria-hidden", "true");
  }

  function populateMobileDetail(rec) {
    if (!rec) return;
    var code = document.getElementById("mobile-detail-record-code");
    var dt = document.getElementById("mobile-detail-datetime");
    var badge = document.getElementById("mobile-detail-focus-badge");
    var img = document.getElementById("mobile-detail-photo");
    var fb = document.getElementById("mobile-detail-photo-fallback");
    if (code) code.textContent = rec.displayId || "PAB-2025-0" + rec.recordCode;
    if (dt) dt.textContent = rec.date + " — " + rec.time;
    if (badge) badge.textContent = rec.focus + "% focus";
    if (rec.photoDataUrl && img && fb) {
      img.src = rec.photoDataUrl;
      img.classList.remove("hidden");
      fb.classList.add("hidden");
    } else if (img && fb) {
      img.classList.add("hidden");
      fb.classList.remove("hidden");
    }
    var sf = document.getElementById("mobile-detail-stat-focus");
    var sm = document.getElementById("mobile-detail-stat-mood");
    var sl = document.getElementById("mobile-detail-stat-light");
    var sd = document.getElementById("mobile-detail-stat-duration");
    var notes = document.getElementById("mobile-detail-notes");
    var fl = document.getElementById("mobile-detail-focus-pct-label");
    var bar = document.getElementById("mobile-detail-focus-bar");
    if (sf) sf.textContent = rec.focus + "%";
    if (sm) sm.textContent = rec.mood;
    if (sl) sl.textContent = rec.light;
    if (sd) sd.textContent = rec.duration || "—";
    if (notes) notes.textContent = rec.notes || "";
    if (fl) fl.textContent = rec.focus + "%";
    if (bar) bar.style.width = rec.focus + "%";
    var dc = document.getElementById("canvas-mobile-detail-pc");
    if (dc) drawPointCloudPortable(dc, "mobile-detail-" + rec.id, 85);
  }

  function syncCaptureThumb() {
    var img = document.getElementById("mobile-capture-ref-img");
    var fb = document.getElementById("mobile-capture-ref-fallback");
    if (!img || !fb) return;
    if (state.uploadedImage) {
      img.src = state.uploadedImage;
      img.classList.remove("hidden");
      fb.classList.add("hidden");
    } else {
      img.classList.add("hidden");
      fb.classList.remove("hidden");
    }
  }

  function syncProcessingPhoto() {
    var img = document.getElementById("mobile-proc-photo-img");
    var ph = document.getElementById("mobile-proc-photo-placeholder");
    if (!img || !ph) return;
    if (state.uploadedImage) {
      img.src = state.uploadedImage;
      img.classList.remove("hidden");
      ph.classList.add("hidden");
    } else {
      img.classList.add("hidden");
      ph.classList.remove("hidden");
    }
  }

  function syncLogFocusUi() {
    var range = document.getElementById("mobile-log-focus-range");
    var fill = document.getElementById("mobile-log-focus-fill");
    var thumb = document.getElementById("mobile-log-focus-thumb");
    var num = document.getElementById("mobile-log-focus-num");
    if (!range) return;
    var v = Number(range.value);
    state.focusLevel = v;
    syncRangeVisual(range, fill, thumb, v);
    if (num) num.textContent = String(v);
  }

  function syncRecallFocusUi() {
    var range = document.getElementById("mobile-recall-focus-range");
    var fill = document.getElementById("mobile-recall-focus-fill");
    var thumb = document.getElementById("mobile-recall-focus-thumb");
    var num = document.getElementById("mobile-recall-focus-num");
    if (!range) return;
    var v = Number(range.value);
    syncRangeVisual(range, fill, thumb, v);
    if (num) num.textContent = String(v);
  }

  function syncDeskRecallFocusUi() {
    var range = document.getElementById("desk-recall-focus-range");
    var fill = document.getElementById("desk-recall-focus-fill");
    var thumb = document.getElementById("desk-recall-focus-thumb");
    var big = document.getElementById("desk-recall-focus-display");
    if (!range) return;
    var v = Number(range.value);
    syncRangeVisual(range, fill, thumb, v);
    if (big) big.innerHTML = v + "<small>%</small>";
  }

  function prepareDraftLogUi() {
    var now = new Date();
    var idEl = document.getElementById("mobile-log-record-id");
    var tEl = document.getElementById("mobile-log-time");
    var shortId =
      "PAB-" +
      now.getFullYear() +
      "-" +
      pad2(now.getMonth() + 1) +
      pad2(now.getDate()) +
      "-" +
      String(Math.floor(Math.random() * 900) + 100);
    if (idEl) idEl.textContent = "RECORD ID — " + shortId;
    if (tEl) {
      tEl.textContent = formatLogTime(now);
    }
    var range = document.getElementById("mobile-log-focus-range");
    if (range) {
      range.value = String(state.focusLevel);
      syncLogFocusUi();
    }
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatLogDate(now) {
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();
  }

  function formatLogTime(now) {
    var h = now.getHours();
    var m = now.getMinutes();
    var am = h < 12;
    var h12 = h % 12 || 12;
    return h12 + ":" + pad2(m) + (am ? "am" : "pm");
  }

  function stopDeskCameraTracks() {
    if (deskCameraStream) {
      deskCameraStream.getTracks().forEach(function (t) {
        t.stop();
      });
      deskCameraStream = null;
    }
    var v = document.getElementById("desk-camera-video");
    if (v) {
      v.srcObject = null;
      v.classList.add("hidden");
    }
  }

  function refreshDeskCameraStatus() {
    var v = document.getElementById("desk-camera-video");
    var still = document.getElementById("desk-viewfinder-still");
    var el = document.getElementById("desk-camera-status");
    if (!el) return;
    var live = v && !v.classList.contains("hidden") && v.srcObject;
    var hasStill = still && !still.classList.contains("hidden") && still.getAttribute("src");
    if (live) {
      el.textContent = "LIVE PREVIEW";
    } else if (hasStill) {
      el.textContent = "PHOTO READY";
    } else {
      el.textContent = "CAMERA INACTIVE";
    }
  }

  function syncDeskViewfinderLayers() {
    var v = document.getElementById("desk-camera-video");
    var still = document.getElementById("desk-viewfinder-still");
    var ph = document.getElementById("desk-camera-placeholder");
    var live = v && !v.classList.contains("hidden") && v.srcObject;
    var hasStill = still && !still.classList.contains("hidden") && still.getAttribute("src");
    if (ph) {
      if (live || hasStill) {
        ph.classList.add("hidden");
      } else {
        ph.classList.remove("hidden");
      }
    }
    refreshDeskCameraStatus();
  }

  function stopDeskCamera() {
    stopDeskCameraTracks();
    syncDeskViewfinderLayers();
  }

  function startDeskCamera() {
    if (!window.matchMedia("(min-width: 769px)").matches) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      syncDeskViewfinderLayers();
      return;
    }
    var stillEl = document.getElementById("desk-viewfinder-still");
    if (stillEl) {
      stillEl.classList.add("hidden");
      stillEl.removeAttribute("src");
    }
    stopDeskCameraTracks();
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then(function (stream) {
        deskCameraStream = stream;
        var vid = document.getElementById("desk-camera-video");
        if (!vid) return;
        vid.srcObject = stream;
        vid.classList.remove("hidden");
        syncDeskViewfinderLayers();
      })
      .catch(function () {
        syncDeskViewfinderLayers();
      });
  }

  function showDeskViewfinderStill(dataUrl) {
    stopDeskCameraTracks();
    var still = document.getElementById("desk-viewfinder-still");
    if (still) {
      still.src = dataUrl;
      still.classList.remove("hidden");
    }
    syncDeskViewfinderLayers();
    syncDeskContinueStep1Button();
  }

  function captureDeskPhotoFromVideo() {
    var v = document.getElementById("desk-camera-video");
    if (!v || !v.srcObject) return false;
    if (v.readyState < 2) return false;
    var w = v.videoWidth;
    var h = v.videoHeight;
    if (!w || !h) return false;
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(v, 0, 0, w, h);
    var url = canvas.toDataURL("image/jpeg", 0.92);
    state.uploadedImage = url;
    showDeskViewfinderStill(url);
    syncDeskRefCardFromState();
    syncDeskContinueStep1Button();
    return true;
  }

  function syncDeskRefCardFromState() {
    var thumbImg = document.getElementById("desk-ref-thumb-img");
    var thumbFb = document.getElementById("desk-ref-thumb-fallback");
    var dt = document.getElementById("desk-ref-datetime");
    if (state.uploadedImage && thumbImg && thumbFb) {
      thumbImg.src = state.uploadedImage;
      thumbImg.classList.remove("hidden");
      thumbFb.classList.add("hidden");
    } else if (thumbImg && thumbFb) {
      thumbImg.classList.add("hidden");
      thumbFb.classList.remove("hidden");
    }
    if (dt) {
      var now = new Date();
      dt.textContent = formatLogDate(now) + " — " + formatLogTime(now);
    }
  }

  function onDeskTakePhotoClick() {
    if (!window.matchMedia("(min-width: 769px)").matches) return;
    var v = document.getElementById("desk-camera-video");
    if (v && v.srcObject && v.readyState >= 2 && v.videoWidth > 0) {
      if (captureDeskPhotoFromVideo()) return;
    }
    startDeskCamera();
  }

  function saveMobileRecord() {
    var notesEl = document.getElementById("mobile-log-notes");
    var idLine = document.getElementById("mobile-log-record-id");
    var now = new Date();
    var displayId = idLine ? idLine.textContent.replace(/^RECORD ID —\s*/i, "").trim() : "PAB-NEW";
    var rec = {
      id: "rec-" + now.getTime(),
      recordCode: String(Math.floor(Math.random() * 900) + 100),
      displayId: displayId,
      date: formatLogDate(now),
      time: formatLogTime(now),
      focus: state.focusLevel,
      mood: state.selectedMood,
      light: state.selectedLighting,
      objects: 4 + Math.floor(Math.random() * 3),
      notes: notesEl ? notesEl.value : "",
      photoDataUrl: state.uploadedImage,
      duration: "1h 20m",
      createdAt: now.getTime(),
    };
    var all = getAllRecords();
    all.unshift(rec);
    saveRecordsToStorage(all);
    state.uploadedImage = null;
    state.mobileStack = [];
    buildDeskArchiveRows();
    updateDeskArchiveMeta();
    buildMobileArchiveList();
    showMobileScreen("archive");
  }

  function getActiveMobileScreen() {
    var el = document.querySelector(".mobile-screen.is-active");
    return el ? el.getAttribute("data-mobile-screen") : "landing";
  }

  function navigateMobileForward(next) {
    var cur = getActiveMobileScreen();
    if (cur && cur !== next) state.mobileStack.push(cur);
    showMobileScreen(next);
  }

  function navigateMobileBack() {
    var prev = state.mobileStack.pop();
    if (prev) showMobileScreen(prev);
    else showMobileScreen("landing");
  }

  function getDeskSectionFromHash() {
    var h = (window.location.hash || "#home").slice(1).toLowerCase();
    if (["home", "new-entry", "archive", "recall"].indexOf(h) >= 0) return h;
    return "home";
  }

  function syncDeskContinueStep1Button() {
    var btn = document.getElementById("desk-btn-continue-step1");
    if (!btn) return;
    var has = !!state.uploadedImage;
    btn.disabled = !has;
  }

  function updateDeskEntryStepper(n) {
    var root = document.getElementById("desk-page-new-entry");
    if (!root) return;
    var items = root.querySelectorAll(".desk-step-item");
    var lines = root.querySelectorAll(".desk-step-line");
    items.forEach(function (item, idx) {
      var step = idx + 1;
      var num = item.querySelector(".desk-step-num");
      var lbl = item.querySelector(".desk-step-label");
      if (num) {
        num.classList.toggle("is-current", step === n);
        num.classList.toggle("is-complete", step < n);
      }
      if (lbl) {
        lbl.classList.toggle("is-current", step === n);
      }
    });
    lines.forEach(function (line, idx) {
      line.classList.toggle("is-done", n > idx + 1);
    });
  }

  function refreshDeskEntryProcessPanel() {
    var img = document.getElementById("desk-process-source-thumb");
    var canvas = document.getElementById("canvas-desk-entry-process");
    if (img && state.uploadedImage) {
      img.src = state.uploadedImage;
    }
    if (canvas && state.uploadedImage) {
      var seed = "desk-proc-" + String(state.uploadedImage.length) + "-" + String(hashString(state.uploadedImage.slice(0, 80)));
      drawPointCloudMetatool(canvas, seed, 130);
    }
  }

  function syncDeskLogFocusUi() {
    var range = document.getElementById("desk-log-focus-range");
    var fill = document.getElementById("desk-log-focus-fill");
    var thumb = document.getElementById("desk-log-focus-thumb");
    var big = document.getElementById("desk-log-focus-display");
    if (!range) return;
    var v = Number(range.value);
    state.focusLevel = v;
    syncRangeVisual(range, fill, thumb, v);
    if (big) big.innerHTML = v + "<small>%</small>";
  }

  function getDeskLogMood() {
    var inp = document.getElementById("desk-log-mood-input");
    if (inp && inp.value.trim()) {
      return inp.value.trim();
    }
    var on = document.querySelector('[data-desk-chip-group="log-mood"] button.is-on');
    return on ? on.textContent.trim() : state.selectedMood;
  }

  function getDeskLogLight() {
    var on = document.querySelector('[data-desk-chip-group="log-light"] button.is-on');
    return on ? on.textContent.trim() : state.selectedLighting;
  }

  function prepareDeskLogUi() {
    var now = new Date();
    var idEl = document.getElementById("desk-log-record-id-display");
    var tEl = document.getElementById("desk-log-time-display");
    var shortId =
      "PAB-" +
      now.getFullYear() +
      "-" +
      pad2(now.getMonth() + 1) +
      pad2(now.getDate()) +
      "-" +
      String(Math.floor(Math.random() * 900) + 100);
    if (idEl) idEl.textContent = "RECORD ID — " + shortId;
    if (tEl) tEl.textContent = formatLogTime(now);
    var range = document.getElementById("desk-log-focus-range");
    if (range) {
      range.value = String(state.focusLevel);
      syncDeskLogFocusUi();
    }
    var moodInp = document.getElementById("desk-log-mood-input");
    if (moodInp) moodInp.value = state.selectedMood;
    document.querySelectorAll("[data-desk-log-mood]").forEach(function (b) {
      b.classList.toggle("is-on", b.textContent.trim() === state.selectedMood);
    });
    document.querySelectorAll("[data-desk-log-light]").forEach(function (b) {
      b.classList.toggle("is-on", b.textContent.trim() === state.selectedLighting);
    });
    var notes = document.getElementById("desk-log-notes");
    if (notes) notes.value = "";
  }

  function syncDeskSaveSummary() {
    var mood = getDeskLogMood();
    var light = getDeskLogLight();
    var idLine = document.getElementById("desk-log-record-id-display");
    var saveId = document.getElementById("desk-save-record-id");
    var sum = document.getElementById("desk-save-summary");
    if (saveId && idLine) {
      saveId.textContent = idLine.textContent.replace(/^RECORD ID —\s*/i, "").trim();
    }
    if (sum) {
      sum.textContent = state.focusLevel + "% focus · " + mood + " · " + light;
    }
    var thumb = document.getElementById("desk-save-thumb");
    var tfb = document.getElementById("desk-save-thumb-fallback");
    if (state.uploadedImage && thumb && tfb) {
      thumb.src = state.uploadedImage;
      thumb.classList.remove("hidden");
      tfb.classList.add("hidden");
    } else if (thumb && tfb) {
      thumb.classList.add("hidden");
      tfb.classList.remove("hidden");
    }
  }

  function setDeskEntryStep(n) {
    if (n >= 2) {
      stopDeskCameraTracks();
    }
    state.deskEntryStep = n;
    document.querySelectorAll(".desk-entry-panel").forEach(function (el) {
      var s = parseInt(el.getAttribute("data-desk-entry-step"), 10);
      el.classList.toggle("is-active", s === n);
    });
    document.querySelectorAll(".desk-entry-sidebar-panel").forEach(function (el) {
      var s = parseInt(el.getAttribute("data-desk-entry-step"), 10);
      el.classList.toggle("is-active", s === n);
    });
    updateDeskEntryStepper(n);
    if (n === 1) {
      if (state.uploadedImage) {
        showDeskViewfinderStill(state.uploadedImage);
        syncDeskRefCardFromState();
      } else {
        var still = document.getElementById("desk-viewfinder-still");
        if (still) {
          still.classList.add("hidden");
          still.removeAttribute("src");
        }
        syncDeskViewfinderLayers();
        if (window.matchMedia("(min-width: 769px)").matches) {
          startDeskCamera();
        }
      }
      syncDeskContinueStep1Button();
    }
    if (n === 2) {
      refreshDeskEntryProcessPanel();
    }
    if (n === 3) {
      prepareDeskLogUi();
    }
    if (n === 4) {
      syncDeskSaveSummary();
    }
  }

  function saveDeskRecord() {
    var notesEl = document.getElementById("desk-log-notes");
    var idEl = document.getElementById("desk-log-record-id-display");
    var displayId = idEl ? idEl.textContent.replace(/^RECORD ID —\s*/i, "").trim() : "PAB-NEW";
    var now = new Date();
    var rec = {
      id: "rec-" + now.getTime(),
      recordCode: String(Math.floor(Math.random() * 900) + 100),
      displayId: displayId,
      date: formatLogDate(now),
      time: formatLogTime(now),
      focus: state.focusLevel,
      mood: getDeskLogMood(),
      light: getDeskLogLight(),
      objects: 4 + Math.floor(Math.random() * 3),
      notes: notesEl ? notesEl.value : "",
      photoDataUrl: state.uploadedImage,
      duration: "1h 20m",
      createdAt: now.getTime(),
    };
    var all = getAllRecords();
    all.unshift(rec);
    saveRecordsToStorage(all);
    state.uploadedImage = null;
    state.deskEntryStep = 1;
    buildDeskArchiveRows();
    updateDeskArchiveMeta();
    buildMobileArchiveList();
    window.location.hash = "archive";
  }

  function bindDeskLogFormChips() {
    var logPanel = document.getElementById("desk-entry-panel-log");
    if (!logPanel) return;
    logPanel.addEventListener("click", function (e) {
      var m = e.target.closest("[data-desk-log-mood]");
      if (m) {
        var row = m.closest("[data-desk-chip-group]");
        if (row) {
          row.querySelectorAll("[data-desk-log-mood]").forEach(function (b) {
            b.classList.remove("is-on");
          });
        }
        m.classList.add("is-on");
        state.selectedMood = m.textContent.trim();
        var inp = document.getElementById("desk-log-mood-input");
        if (inp) inp.value = state.selectedMood;
        return;
      }
      var l = e.target.closest("[data-desk-log-light]");
      if (l) {
        var row2 = l.closest("[data-desk-chip-group]");
        if (row2) {
          row2.querySelectorAll("[data-desk-log-light]").forEach(function (b) {
            b.classList.remove("is-on");
          });
        }
        l.classList.add("is-on");
        state.selectedLighting = l.textContent.trim();
      }
    });
    var moodInp = document.getElementById("desk-log-mood-input");
    if (moodInp) {
      moodInp.addEventListener("input", function () {
        var v = moodInp.value.trim();
        if (v) state.selectedMood = v;
      });
    }
  }

  function showDeskPage(id) {
    document.querySelectorAll(".desk-page").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-desk-page") === id);
    });
    document.querySelectorAll(".desk-nav-links a").forEach(function (a) {
      a.classList.toggle("is-active", a.getAttribute("data-desk-nav") === id);
    });
    if (id === "home") {
      var c = document.getElementById("canvas-desk-home-cloud");
      if (c) drawPointCloudMetatool(c, "desk-home-hero", 200);
    }
    if (id === "new-entry") {
      setDeskEntryStep(state.deskEntryStep || 1);
    } else {
      stopDeskCamera();
    }
    if (id === "recall") {
      findDeskMatchesAndRender();
    }
  }

  function showMobileScreen(name) {
    document.querySelectorAll(".mobile-screen").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-mobile-screen") === name);
    });
    var phone = document.getElementById("phone-root");
    if (phone) phone.classList.toggle("phone--landing", name === "landing");

    if (name === "landing") {
      var lc = document.getElementById("canvas-mobile-landing-pc");
      if (lc) drawPointCloudPortable(lc, "mobile-landing", 180);
    }
    if (name === "processing") {
      var pc = document.getElementById("canvas-mobile-proc-pc");
      if (pc) drawPointCloudPortable(pc, "mobile-proc", 90);
      syncProcessingPhoto();
    }
    if (name === "log") {
      prepareDraftLogUi();
    }
    if (name === "archive") {
      buildMobileArchiveList();
    }
    if (name === "detail" && state.selectedRecord) {
      populateMobileDetail(state.selectedRecord);
    }
    if (name === "capture") {
      syncCaptureThumb();
    }
  }

  function onHashChange() {
    if (window.matchMedia("(min-width: 769px)").matches) {
      showDeskPage(getDeskSectionFromHash());
    }
  }

  function bindDeskRecallChips() {
    document.querySelectorAll("[data-desk-recall-mood]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("[data-desk-chip-group]");
        if (!row) return;
        row.querySelectorAll("[data-desk-recall-mood]").forEach(function (b) {
          b.classList.remove("is-on");
        });
        btn.classList.add("is-on");
      });
    });
    document.querySelectorAll("[data-desk-recall-light]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("[data-desk-chip-group]");
        if (!row) return;
        row.querySelectorAll("[data-desk-recall-light]").forEach(function (b) {
          b.classList.remove("is-on");
        });
        btn.classList.add("is-on");
      });
    });
  }

  function init() {
    renderHalftone(document.getElementById("mobile-halftone"), 390, 844);
    loadRecordsFromStorage();

    buildDeskArchiveRows();
    findDeskMatchesAndRender();
    buildMobileArchiveList();
    buildMobileRecallList(computeMobileMatches());

    bindDeskRecallChips();

    var deskRange = document.getElementById("desk-recall-focus-range");
    if (deskRange) {
      deskRange.addEventListener("input", syncDeskRecallFocusUi);
      syncDeskRecallFocusUi();
    }
    var deskFind = document.getElementById("desk-btn-find-recall");
    if (deskFind) {
      deskFind.addEventListener("click", findDeskMatchesAndRender);
    }

    var deskPhotoInput = document.getElementById("desk-photo-input");
    if (deskPhotoInput) {
      deskPhotoInput.addEventListener("change", function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f || !/^image\//.test(f.type)) return;
        var reader = new FileReader();
        reader.onload = function () {
          state.uploadedImage = reader.result;
          showDeskViewfinderStill(reader.result);
          syncDeskRefCardFromState();
          syncDeskContinueStep1Button();
        };
        reader.readAsDataURL(f);
        e.target.value = "";
      });
    }
    var deskTake = document.getElementById("desk-btn-take-photo");
    if (deskTake) {
      deskTake.addEventListener("click", onDeskTakePhotoClick);
    }
    var deskCont1 = document.getElementById("desk-btn-continue-step1");
    if (deskCont1) {
      deskCont1.addEventListener("click", function () {
        if (!state.uploadedImage) return;
        setDeskEntryStep(2);
      });
    }
    var deskCont2 = document.getElementById("desk-btn-continue-step2");
    if (deskCont2) {
      deskCont2.addEventListener("click", function () {
        setDeskEntryStep(3);
      });
    }
    var deskBack2 = document.getElementById("desk-btn-back-step2");
    if (deskBack2) {
      deskBack2.addEventListener("click", function () {
        setDeskEntryStep(1);
      });
    }
    var deskCont3 = document.getElementById("desk-btn-continue-step3");
    if (deskCont3) {
      deskCont3.addEventListener("click", function () {
        setDeskEntryStep(4);
      });
    }
    var deskBack3 = document.getElementById("desk-btn-back-step3");
    if (deskBack3) {
      deskBack3.addEventListener("click", function () {
        setDeskEntryStep(2);
      });
    }
    var deskBack4 = document.getElementById("desk-btn-back-step4");
    if (deskBack4) {
      deskBack4.addEventListener("click", function () {
        setDeskEntryStep(3);
      });
    }
    var deskSaveEntry = document.getElementById("desk-btn-save-entry");
    if (deskSaveEntry) {
      deskSaveEntry.addEventListener("click", saveDeskRecord);
    }
    var deskLogRange = document.getElementById("desk-log-focus-range");
    if (deskLogRange) {
      deskLogRange.addEventListener("input", syncDeskLogFocusUi);
    }
    bindDeskLogFormChips();
    var deskClose = document.getElementById("desk-detail-close");
    if (deskClose) deskClose.addEventListener("click", closeDeskDetail);
    var deskRec = document.getElementById("desk-detail-recreate");
    if (deskRec) {
      deskRec.addEventListener("click", function () {
        closeDeskDetail();
        state.deskEntryStep = 1;
        window.location.hash = "new-entry";
      });
    }
    var deskOv = document.getElementById("desk-detail-overlay");
    if (deskOv) {
      deskOv.addEventListener("click", function (e) {
        if (e.target === deskOv) closeDeskDetail();
      });
    }

    var logRange = document.getElementById("mobile-log-focus-range");
    if (logRange) {
      logRange.addEventListener("input", syncLogFocusUi);
      syncLogFocusUi();
    }
    var mRecRange = document.getElementById("mobile-recall-focus-range");
    if (mRecRange) {
      mRecRange.addEventListener("input", syncRecallFocusUi);
      syncRecallFocusUi();
    }

    var photoInput = document.getElementById("mobile-photo-input");
    if (photoInput) {
      photoInput.addEventListener("change", function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f || !/^image\//.test(f.type)) return;
        var r = new FileReader();
        r.onload = function () {
          state.uploadedImage = r.result;
          syncCaptureThumb();
          syncProcessingPhoto();
        };
        r.readAsDataURL(f);
        e.target.value = "";
      });
    }
    var takeBtn = document.getElementById("mobile-btn-take-photo");
    if (takeBtn) {
      takeBtn.addEventListener("click", function () {
        navigateMobileForward("processing");
      });
    }
    var contLog = document.getElementById("mobile-btn-continue-log");
    if (contLog) {
      contLog.addEventListener("click", function () {
        navigateMobileForward("log");
      });
    }
    var saveBtn = document.getElementById("mobile-btn-save-record");
    if (saveBtn) saveBtn.addEventListener("click", saveMobileRecord);

    var loadEarlier = document.getElementById("mobile-btn-load-earlier");
    if (loadEarlier) {
      loadEarlier.addEventListener("click", function () {
        state.showEarlierMobile = true;
        buildMobileArchiveList();
      });
    }

    var findMob = document.getElementById("mobile-btn-find-match");
    if (findMob) {
      findMob.addEventListener("click", function () {
        buildMobileRecallList(computeMobileMatches());
      });
    }

    var mobRecreate = document.getElementById("mobile-btn-recreate");
    if (mobRecreate) {
      mobRecreate.addEventListener("click", function () {
        var rec = state.selectedRecord;
        state.mobileStack = [];
        if (rec && rec.photoDataUrl) state.uploadedImage = rec.photoDataUrl;
        else state.uploadedImage = null;
        if (rec) {
          state.focusLevel = rec.focus;
          state.selectedMood = rec.mood;
          state.selectedLighting = rec.light;
        }
        var lr = document.getElementById("mobile-log-focus-range");
        if (lr) lr.value = String(state.focusLevel);
        syncLogFocusUi();
        syncCaptureThumb();
        syncProcessingPhoto();
        showMobileScreen("capture");
      });
    }

    document.querySelectorAll(".js-mobile-back").forEach(function (btn) {
      btn.addEventListener("click", function () {
        navigateMobileBack();
      });
    });

    var logSection = document.getElementById("mobile-log");
    if (logSection) {
      logSection.addEventListener("click", function (e) {
        var m = e.target.closest("[data-mood-chip]");
        if (m) {
          m.parentElement.querySelectorAll("[data-mood-chip]").forEach(function (b) {
            b.classList.remove("active");
          });
          m.classList.add("active");
          state.selectedMood = m.textContent.trim();
          var inp = document.getElementById("mobile-log-mood-input");
          if (inp) inp.value = state.selectedMood;
          return;
        }
        var l = e.target.closest("[data-light-chip]");
        if (l) {
          var crow = l.closest(".chip-row");
          if (crow) {
            crow.querySelectorAll("[data-light-chip]").forEach(function (b) {
              b.classList.remove("active");
            });
          }
          l.classList.add("active");
          state.selectedLighting = l.textContent.trim();
        }
      });
    }
    var moodInp = document.getElementById("mobile-log-mood-input");
    if (moodInp) {
      moodInp.addEventListener("input", function () {
        state.selectedMood = moodInp.value.trim() || state.selectedMood;
      });
    }

    var recallSection = document.querySelector("#mobile-recall [data-chip-group=\"recall-mood\"]");
    if (recallSection) {
      recallSection.addEventListener("click", function (e) {
        var c = e.target.closest("[data-recall-mood-chip]");
        if (!c) return;
        recallSection.querySelectorAll("[data-recall-mood-chip]").forEach(function (b) {
          b.classList.remove("active");
        });
        c.classList.add("active");
        state.recallMood = c.textContent.trim();
      });
    }

    document.querySelectorAll("[data-desk-nav]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        var navId = el.getAttribute("data-desk-nav");
        if (!navId || !el.getAttribute("href") || el.getAttribute("href").indexOf("#") !== 0) return;
        e.preventDefault();
        window.location.hash = navId;
      });
    });

    document.querySelectorAll("[data-mobile-go]").forEach(function (el) {
      el.addEventListener("click", function () {
        navigateMobileForward(el.getAttribute("data-mobile-go"));
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDeskDetail();
    });

    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("resize", function () {
      if (window.matchMedia("(min-width: 769px)").matches) {
        showDeskPage(getDeskSectionFromHash());
      }
    });

    if (window.matchMedia("(min-width: 769px)").matches) {
      showDeskPage(getDeskSectionFromHash());
    } else {
      showMobileScreen("landing");
    }

    var c0 = document.getElementById("canvas-desk-home-cloud");
    if (c0 && window.matchMedia("(min-width: 769px)").matches) {
      drawPointCloudMetatool(c0, "desk-home-hero", 200);
    }

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./service-worker.js").catch(function () {});
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
