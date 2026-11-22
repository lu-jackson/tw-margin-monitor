"use strict";
/* Shared header controls: fullscreen toggle. Loaded by index.html and guide.html; touches nothing else.
   Fullscreen hides the browser's own toolbars, bookmarks bar and (on Windows) the taskbar. */
(function () {
  const root = document.documentElement;
  const btn = document.getElementById("fsBtn");
  if (!btn) return;
  const req = root.requestFullscreen || root.webkitRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!req) { btn.hidden = true; return; }   // e.g. iPhone Safari has no Fullscreen API
  const paint = () => {
    const on = isFs();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.querySelector(".lab").textContent = on ? "EXIT FULL" : "FULLSCREEN";
    btn.querySelector(".ico").textContent = on ? "⤡" : "⤢";
    btn.title = on ? "Exit fullscreen (Esc or F)" : "Enter fullscreen (F)";
  };
  const blocked = () => {   // browser / embedding refused the request: point to the F11 shortcut instead
    btn.querySelector(".lab").textContent = "BLOCKED · TRY F11";
    setTimeout(paint, 2800);
  };
  const toggle = () => {
    try {
      const p = isFs() ? exit.call(document) : req.call(root);
      if (p && p.catch) p.catch(blocked);
    } catch (e) { blocked(); }
  };
  btn.addEventListener("click", toggle);
  document.addEventListener("fullscreenchange", paint);
  document.addEventListener("webkitfullscreenchange", paint);
  document.addEventListener("keydown", e => {
    if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ""))) toggle();
  });
  paint();
})();
