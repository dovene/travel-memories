/* Inline SVG icon set (stroke icons, 24×24). */
(function () {
  "use strict";
  var a = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var TM = (window.TM = window.TM || {});
  TM.icons = {
    search: "<svg " + a + '><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    close: "<svg " + a + '><path d="M18 6 6 18M6 6l12 12"/></svg>',
    arrowRight: "<svg " + a + '><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    arrowLeft: "<svg " + a + '><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
    arrowUpRight: "<svg " + a + '><path d="M7 17 17 7M8 7h9v9"/></svg>',
    chevronLeft: "<svg " + a + '><path d="m15 18-6-6 6-6"/></svg>',
    chevronRight: "<svg " + a + '><path d="m9 18 6-6-6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>',
    volume: "<svg " + a + '><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    volumeOff: "<svg " + a + '><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
    replay: "<svg " + a + '><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4"/></svg>',
    chart: "<svg " + a + '><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    archive: "<svg " + a + '><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>',
    download: "<svg " + a + '><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
    camera: "<svg " + a + '><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    video: "<svg " + a + '><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
    user: "<svg " + a + '><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    pin: "<svg " + a + '><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    compass: "<svg " + a + '><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>',
    check: "<svg " + a + '><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    upload: "<svg " + a + '><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
    trash: "<svg " + a + '><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    star: "<svg " + a + '><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
    plus: "<svg " + a + '><path d="M12 5v14M5 12h14"/></svg>',
    eye: "<svg " + a + '><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    logout: "<svg " + a + '><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
    alert: "<svg " + a + '><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
    image: "<svg " + a + '><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    menu: "<svg " + a + '><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.2 8.1a1 1 0 0 1 1.6-.9l3.9 3.1 2.5-4.8a1 1 0 0 1 1.8 0l2.5 4.8 3.9-3.1a1 1 0 0 1 1.6.9l-1.6 9.1a1 1 0 0 1-1 .8H5.8a1 1 0 0 1-1-.8z"/><rect x="5.5" y="19.5" width="13" height="1.8" rx=".9"/></svg>'
  };
})();
