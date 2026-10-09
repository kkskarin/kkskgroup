/* Text Size for every KKSK app (Personalise). Phones and tablets: the browser lays the page out for the larger
   (or smaller) size through the viewport, so nothing spills off the screen. Computers: the page is zoomed. */
(function () {
  "use strict";
  var BASE = "width=device-width,initial-scale=1,viewport-fit=cover", cur = 1;
  function touch() { return !!(window.matchMedia && matchMedia("(pointer:coarse)").matches) && Math.min(screen.width, screen.height) < 1100; }
  function deviceWidth() {
    var w = screen.width, h = screen.height, land = window.screen.orientation ? /landscape/.test(screen.orientation.type) : Math.abs(window.orientation || 0) === 90;
    return land ? Math.max(w, h) : Math.min(w, h);
  }
  function apply(z) {
    cur = z > 0 ? z : 1;
    var root = document.documentElement, meta = document.querySelector('meta[name="viewport"]');
    if (touch() && meta) {
      root.style.zoom = ""; if (document.body) document.body.style.zoom = "";
      meta.setAttribute("content", cur === 1 ? BASE : "width=" + Math.round(deviceWidth() / cur) + ",initial-scale=" + cur + ",viewport-fit=cover");
    } else {
      if (meta) meta.setAttribute("content", BASE);
      root.style.zoom = cur === 1 ? "" : String(cur); if (document.body) document.body.style.zoom = "";
    }
  }
  window.addEventListener("orientationchange", function () { setTimeout(function () { apply(cur); }, 150); });
  window.kkskTextSize = apply;
})();
