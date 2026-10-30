/* Text Size for every KKSK app (Personalise). Only the text grows or shrinks: every font size in the apps is written as
   calc(size * var(--ts)), so tables, columns and boxes keep their layout and their cells wrap to fit the bigger text. */
(function () {
  "use strict";
  function apply(z) {
    var cur = z > 0 ? z : 1, root = document.documentElement;
    root.style.zoom = ""; if (document.body) document.body.style.zoom = "";
    if (cur === 1) root.style.removeProperty("--ts"); else root.style.setProperty("--ts", String(cur));
  }
  window.kkskTextSize = apply;
})();
