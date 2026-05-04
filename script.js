/**
 * Portable Attention Box — dual-shell navigation (desktop ≥769px, mobile ≤768px)
 * Point clouds + halftone rendered to match Claude Design references.
 */
(function () {
  "use strict";

  var DESKTOP_RECORDS = [
    { id: "041", date: "Apr 12, 2025", time: "9:41am", focus: 72, mood: "Calm", light: "Soft", objects: 5 },
    { id: "040", date: "Apr 11, 2025", time: "8:15am", focus: 88, mood: "Focused", light: "Bright", objects: 5 },
    { id: "039", date: "Apr 9, 2025", time: "2:02pm", focus: 45, mood: "Restless", light: "Artificial", objects: 4 },
    { id: "038", date: "Apr 7, 2025", time: "10:30am", focus: 61, mood: "Alert", light: "Soft", objects: 6 },
    { id: "037", date: "Apr 5, 2025", time: "7:55am", focus: 79, mood: "Calm", light: "Bright", objects: 5 },
    { id: "036", date: "Apr 3, 2025", time: "11:20am", focus: 55, mood: "Tired", light: "Dim", objects: 3 },
  ];

  var MOBILE_ARCHIVE_RECORDS = [
    { id: "041", date: "Apr 12, 2025", time: "9:41am", focus: 72, mood: "Calm", light: "Soft" },
    { id: "040", date: "Apr 11, 2025", time: "8:15am", focus: 88, mood: "Focused", light: "Bright" },
    { id: "039", date: "Apr 9, 2025", time: "2:02pm", focus: 45, mood: "Restless", light: "Artificial" },
    { id: "038", date: "Apr 7, 2025", time: "10:30am", focus: 61, mood: "Alert", light: "Soft" },
  ];

  var RECALL_RESULTS = [
    { date: "Apr 11", focus: 88, mood: "Focused", light: "Bright", match: 97, best: true },
    { date: "Apr 7", focus: 82, mood: "Alert", light: "Soft", match: 91, best: false },
    { date: "Mar 30", focus: 79, mood: "Calm", light: "Bright", match: 84, best: false },
    { date: "Mar 18", focus: 85, mood: "Focused", light: "Bright", match: 78, best: false },
  ];

  var MOBILE_RECALL = [
    { date: "Apr 11", focus: 88, mood: "Focused", light: "Bright", match: 97 },
    { date: "Apr 7", focus: 82, mood: "Alert", light: "Soft", match: 91 },
    { date: "Mar 30", focus: 79, mood: "Calm", light: "Bright", match: 84 },
  ];

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i += 1) {
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

  /** Metatool Website.html PointCloud */
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

  /** Portable Attention Box.html PointCloud */
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

  function buildDeskArchiveRows() {
    var host = document.getElementById("desk-archive-rows");
    if (!host) return;
    host.innerHTML = "";
    DESKTOP_RECORDS.forEach(function (r, idx) {
      var row = document.createElement("div");
      row.className = "desk-table-row";
      row.innerHTML =
        '<div class="desk-thumb-cell"><svg viewBox="0 0 60 52" width="60" height="52"><use href="#desk-thumb" /></svg></div>' +
        '<div class="desk-thumb-cell"><canvas width="60" height="52" data-pc-m="desk-arch-' +
        idx +
        '" data-den="28"></canvas></div>' +
        '<div><div class="desk-table-mini">PAB-2025-0' +
        r.id +
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
  }

  function buildDeskRecallResults() {
    var host = document.getElementById("desk-recall-results");
    if (!host) return;
    host.innerHTML = "";
    RECALL_RESULTS.forEach(function (r, i) {
      var card = document.createElement("div");
      card.className = "desk-result-card" + (r.best ? " is-best" : "");
      card.innerHTML =
        '<div class="desk-thumb-cell" style="width:72px;height:60px"><svg viewBox="0 0 60 52" width="72" height="60"><use href="#desk-thumb" /></svg></div>' +
        '<div class="desk-thumb-cell" style="width:72px;height:60px;background:var(--paper2)"><canvas width="72" height="60" data-pc-m="desk-rec-' +
        i +
        '" data-den="32"></canvas></div>' +
        "<div>" +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
        '<span style="font-family:var(--mono);font-size:12px;font-weight:500">' +
        r.date +
        " — " +
        r.focus +
        "% focus</span>" +
        (r.best ? '<span class="desk-badge">Best match</span>' : "") +
        "</div>" +
        '<div style="font-family:var(--mono);font-size:9px;color:var(--gray3);letter-spacing:0.06em;margin-bottom:8px">' +
        r.mood +
        " · " +
        r.light +
        "</div>" +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;height:2px;background:var(--gray1);position:relative">' +
        '<div style="position:absolute;left:0;top:0;height:100%;width:' +
        r.match +
        '%;background:var(--ink)"></div></div>' +
        '<span style="font-family:var(--mono);font-size:9px;letter-spacing:0.08em;color:var(--ink);white-space:nowrap">' +
        r.match +
        "% match</span></div></div>" +
        '<div class="desk-result-actions"><button type="button">Recreate →</button></div>';
      host.appendChild(card);
    });
    host.querySelectorAll("canvas[data-pc-m]").forEach(function (cv) {
      var den = parseInt(cv.getAttribute("data-den"), 10) || 32;
      drawPointCloudMetatool(cv, cv.getAttribute("data-pc-m"), den);
    });
  }

  function buildMobileArchiveList() {
    var host = document.getElementById("mobile-archive-list");
    if (!host) return;
    host.innerHTML = "";
    MOBILE_ARCHIVE_RECORDS.forEach(function (r, i) {
      var card = document.createElement("article");
      card.className = "archive-card";
      card.innerHTML =
        '<div class="thumb-box"><svg viewBox="0 0 174 200" width="56" height="56"><use href="#desk-photo-svg" /></svg></div>' +
        '<div class="thumb-box"><canvas width="56" height="56" data-pc-p="m-arch-' +
        i +
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
    });
    host.querySelectorAll("canvas[data-pc-p]").forEach(function (cv) {
      var den = parseInt(cv.getAttribute("data-den"), 10) || 40;
      drawPointCloudPortable(cv, cv.getAttribute("data-pc-p"), den);
    });
  }

  function buildMobileRecallList() {
    var host = document.getElementById("mobile-recall-list");
    if (!host) return;
    host.innerHTML = "";
    MOBILE_RECALL.forEach(function (r, i) {
      var el = document.createElement("div");
      el.className = "recall-card";
      el.innerHTML =
        '<div style="display:grid;grid-template-columns:48px 48px 1fr;gap:10px;align-items:start">' +
        '<div class="thumb-box" style="width:48px;height:48px"><svg viewBox="0 0 174 200" width="48" height="48"><use href="#desk-photo-svg" /></svg></div>' +
        '<div class="thumb-box" style="width:48px;height:48px"><canvas width="48" height="48" data-pc-p="m-rec-' +
        i +
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
        r.match +
        '%"></div></div>' +
        '<span style="font-size:8px;font-weight:500;letter-spacing:0.08em;white-space:nowrap">' +
        r.match +
        "% match</span></div></div></div>";
      host.appendChild(el);
    });
    host.querySelectorAll("canvas[data-pc-p]").forEach(function (cv) {
      var den = parseInt(cv.getAttribute("data-den"), 10) || 30;
      drawPointCloudPortable(cv, cv.getAttribute("data-pc-p"), den);
    });
  }

  function getDeskSectionFromHash() {
    var h = (window.location.hash || "#home").slice(1).toLowerCase();
    if (["home", "new-entry", "archive", "recall"].indexOf(h) >= 0) return h;
    return "home";
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
    }
    if (name === "detail") {
      var dc = document.getElementById("canvas-mobile-detail-pc");
      if (dc) drawPointCloudPortable(dc, "mobile-detail", 85);
    }
  }

  function onHashChange() {
    if (window.matchMedia("(min-width: 769px)").matches) {
      showDeskPage(getDeskSectionFromHash());
    }
  }

  function init() {
    renderHalftone(document.getElementById("mobile-halftone"), 390, 844);

    buildDeskArchiveRows();
    buildDeskRecallResults();
    buildMobileArchiveList();
    buildMobileRecallList();

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
        showMobileScreen(el.getAttribute("data-mobile-go"));
      });
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
