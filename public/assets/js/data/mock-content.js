/*
 * Mock content for the Phase 0 design prototype.
 *
 * Shapes follow the draft schemas in the specification (profile.json /
 * places.json). In the prototype, `filename` holds an Unsplash photo id so
 * that api.js can build URLs; in production it will be the original file name
 * stored under media/users/<ownerId>/<slug>/ and resolved from a configurable
 * media base URL.
 */
(function () {
  "use strict";

  var SAMPLE_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

  function img(id, file, w, h, en, fr) {
    return { id: id, type: "image", filename: file, width: w, height: h, altText: { en: en, fr: fr || en } };
  }

  function vid(id, en, fr) {
    return { id: id, type: "video", filename: SAMPLE_VIDEO, width: 1280, height: 720, altText: { en: en, fr: fr || en } };
  }

  function place(p) {
    p.ownerId = "dovene";
    p.media.forEach(function (m, i) {
      m.position = i;
    });
    return p;
  }

  var places = [
    place({
      id: "dolomites-2026",
      slug: "dolomites",
      name: { en: "The Dolomites", fr: "Les Dolomites" },
      description: {
        en: "Emerald lakes, wooden boats and pale limestone towers. Mornings on Lago di Braies felt like stepping into a painting that was still drying.",
        fr: "Lacs émeraude, barques en bois et tours de calcaire pâle. Les matins sur le lac de Braies avaient l'air d'un tableau encore frais."
      },
      city: "Braies",
      country: { en: "Italy", fr: "Italie" },
      countryCode: "IT",
      visitedAt: "2026-07",
      coverMediaId: "dol-1",
      media: [
        img("dol-1", "1476514525535-07fb3b4ae5f1", 1600, 1067, "A wooden boat on Lago di Braies", "Une barque sur le lac de Braies"),
        img("dol-2", "1501785888041-af3ef285b470", 1200, 1500, "Turquoise water under the peaks", "Eau turquoise sous les sommets"),
        img("dol-3", "1506905925346-21bda4d32df4", 1600, 1000, "Peaks above a sea of clouds", "Sommets au-dessus d'une mer de nuages"),
        vid("dol-4", "Morning light, slowly", "Lumière du matin, lentement"),
        img("dol-5", "1520769945061-0a448c463865", 1200, 1500, "Snowy ridgeline and green valley", "Crête enneigée et vallée verte")
      ],
      createdAt: "2026-07-22T09:00:00Z",
      updatedAt: "2026-07-22T09:00:00Z"
    }),
    place({
      id: "berlin-2026",
      slug: "berlin",
      name: { en: "Berlin", fr: "Berlin" },
      description: {
        en: "A few memories from my visit to Berlin — long walks between history and the TV tower, and evenings that never quite ended.",
        fr: "Quelques souvenirs de mon séjour à Berlin — de longues marches entre l'histoire et la tour de télévision, et des soirées qui ne finissaient jamais."
      },
      city: "Berlin",
      country: { en: "Germany", fr: "Allemagne" },
      countryCode: "DE",
      visitedAt: "2026-03",
      coverMediaId: "ber-1",
      media: [
        img("ber-1", "1560969184-10fe8719e047", 1200, 1500, "The Brandenburg Gate at dusk", "La porte de Brandebourg au crépuscule"),
        img("ber-2", "1560930950-5cc20e80e392", 1600, 1067, "The TV tower above the rooftops", "La tour de télévision au-dessus des toits"),
        img("ber-3", "1599946347371-68eb71b16afc", 1600, 1067, "Rooftops in warm light", "Toits dans une lumière chaude"),
        vid("ber-4", "A quiet moment in Berlin", "Un moment calme à Berlin"),
        img("ber-5", "1566404791232-af9fe0ae8f8b", 1200, 1600, "Fernsehturm from below", "Le Fernsehturm vu d'en bas"),
        img("ber-6", "1546726747-421c6d69c929", 1600, 1067, "Lights along the river", "Lumières le long de la rivière")
      ],
      createdAt: "2026-03-18T10:00:00Z",
      updatedAt: "2026-03-18T10:00:00Z"
    }),
    place({
      id: "santorini-2025",
      slug: "santorini",
      name: { en: "Santorini", fr: "Santorin" },
      description: {
        en: "Whitewashed walls, blue domes and a caldera that turns gold every evening. Everyone stops to watch the sun go down — and so did I.",
        fr: "Murs blanchis, dômes bleus et une caldeira qui devient dorée chaque soir. Tout le monde s'arrête pour regarder le coucher du soleil — moi aussi."
      },
      city: "Oia",
      country: { en: "Greece", fr: "Grèce" },
      countryCode: "GR",
      visitedAt: "2025-09",
      coverMediaId: "san-2",
      media: [
        img("san-1", "1570077188670-e3a8d69ac5ff", 1600, 1067, "Oia rooftops over the caldera", "Les toits d'Oia sur la caldeira"),
        img("san-2", "1530841377377-3ff06c0ca713", 1200, 1500, "Blue domes above the sea", "Dômes bleus au-dessus de la mer"),
        img("san-3", "1613395877344-13d4a8e0d49e", 1200, 1600, "Bright white terraces", "Terrasses d'un blanc éclatant"),
        img("san-4", "1533105079780-92b9be482077", 1600, 1067, "Village on the cliffs", "Le village sur les falaises"),
        img("san-5", "1571406252241-db0280bd36cd", 1600, 1200, "Bell towers and the Aegean", "Clochers et mer Égée")
      ],
      createdAt: "2025-09-30T10:00:00Z",
      updatedAt: "2025-09-30T10:00:00Z"
    }),
    place({
      id: "kyoto-2025",
      slug: "kyoto",
      name: { en: "Kyoto", fr: "Kyoto" },
      description: {
        en: "Lantern-lit lanes in Gion, ten thousand vermilion gates and a pagoda at sunset. Kyoto rewards those who wake up early.",
        fr: "Ruelles éclairées de lanternes à Gion, dix mille portiques vermillon et une pagode au coucher du soleil. Kyoto récompense les lève-tôt."
      },
      city: "Kyoto",
      country: { en: "Japan", fr: "Japon" },
      countryCode: "JP",
      visitedAt: "2025-04",
      coverMediaId: "kyo-2",
      media: [
        img("kyo-1", "1493976040374-85c8e12f0c0e", 1600, 1067, "Evening street in Higashiyama", "Rue du soir à Higashiyama"),
        img("kyo-2", "1545569341-9eb8b30979d9", 1200, 1500, "Kyoto at sunset", "Kyoto au coucher du soleil"),
        img("kyo-3", "1478436127897-769e1b3f0f36", 1200, 1600, "Fushimi Inari gates", "Les portiques de Fushimi Inari"),
        vid("kyo-4", "Petals and light", "Pétales et lumière"),
        img("kyo-5", "1490806843957-31f4c9a91c65", 1600, 1067, "Mount Fuji on the way", "Le mont Fuji en chemin"),
        img("kyo-6", "1528360983277-13d401cdc186", 1600, 1200, "Neon nights", "Nuits de néons")
      ],
      createdAt: "2025-04-14T10:00:00Z",
      updatedAt: "2025-04-14T10:00:00Z"
    }),
    place({
      id: "rome-2025",
      slug: "rome",
      name: { en: "Rome", fr: "Rome" },
      description: {
        en: "Two thousand years stacked on top of each other, best explored on foot with a gelato in hand.",
        fr: "Deux mille ans d'histoire empilés, à explorer à pied, une glace à la main."
      },
      city: "Rome",
      country: { en: "Italy", fr: "Italie" },
      countryCode: "IT",
      visitedAt: "2025-05",
      coverMediaId: "rom-1",
      media: [
        img("rom-1", "1552832230-c0197dd311b5", 1600, 1200, "The Colosseum in morning light", "Le Colisée dans la lumière du matin"),
        img("rom-2", "1531572753322-ad063cecc140", 1200, 1500, "St. Peter's Square from above", "La place Saint-Pierre vue d'en haut"),
        img("rom-3", "1515542622106-78bda8ba0e5b", 1200, 1600, "Arches of the Colosseum", "Les arches du Colisée")
      ],
      createdAt: "2025-05-20T10:00:00Z",
      updatedAt: "2025-05-20T10:00:00Z"
    }),
    place({
      id: "lisbon-2024",
      slug: "lisbon",
      name: { en: "Lisbon", fr: "Lisbonne" },
      description: {
        en: "Yellow trams climbing impossible hills, tiled façades and a river that glows at dusk.",
        fr: "Des trams jaunes qui gravissent des collines impossibles, des façades en azulejos et un fleuve qui s'illumine au crépuscule."
      },
      city: "Lisbon",
      country: { en: "Portugal", fr: "Portugal" },
      countryCode: "PT",
      visitedAt: "2024-10",
      coverMediaId: "lis-1",
      media: [
        img("lis-1", "1585208798174-6cedd86e019a", 1200, 1500, "Tram 28 in Alfama", "Le tram 28 dans l'Alfama"),
        img("lis-2", "1555881400-74d7acaacd8b", 1600, 1067, "Colourful houses by the water", "Maisons colorées au bord de l'eau"),
        img("lis-3", "1513735492246-483525079686", 1600, 1067, "Sunset over the Tagus", "Coucher de soleil sur le Tage"),
        vid("lis-4", "Afternoon in the garden", "Après-midi au jardin")
      ],
      createdAt: "2024-10-11T10:00:00Z",
      updatedAt: "2024-10-11T10:00:00Z"
    }),
    place({
      id: "venice-2024",
      slug: "venice",
      name: { en: "Venice", fr: "Venise" },
      description: {
        en: "Getting lost is the whole point. Every bridge leads to a quieter canal than the last.",
        fr: "Se perdre, c'est tout l'intérêt. Chaque pont mène à un canal plus calme que le précédent."
      },
      city: "Venice",
      country: { en: "Italy", fr: "Italie" },
      countryCode: "IT",
      visitedAt: "2024-06",
      coverMediaId: "ven-1",
      media: [
        img("ven-1", "1514890547357-a9ee288728e0", 1600, 1067, "Santa Maria della Salute", "Santa Maria della Salute"),
        img("ven-2", "1534113414509-0eec2bfb493f", 1200, 1500, "A narrow canal", "Un canal étroit"),
        img("ven-3", "1523906834658-6e24ef2386f9", 1600, 1067, "The Rialto Bridge", "Le pont du Rialto")
      ],
      createdAt: "2024-06-02T10:00:00Z",
      updatedAt: "2024-06-02T10:00:00Z"
    }),
    place({
      id: "marrakech-2024",
      slug: "marrakech",
      name: { en: "Marrakech", fr: "Marrakech" },
      description: {
        en: "Spice-scented souks, the call to prayer at dusk and a day trip to where the palm groves meet the desert.",
        fr: "Des souks parfumés d'épices, l'appel à la prière au crépuscule et une excursion là où la palmeraie rencontre le désert."
      },
      city: "Marrakech",
      country: { en: "Morocco", fr: "Maroc" },
      countryCode: "MA",
      visitedAt: "2024-02",
      coverMediaId: "mar-1",
      media: [
        img("mar-1", "1597212618440-806262de4f6b", 1200, 1500, "Koutoubia minaret", "Le minaret de la Koutoubia"),
        img("mar-2", "1587974928442-77dc3e0dba72", 1600, 1067, "Jemaa el-Fnaa at dusk", "Jemaa el-Fna au crépuscule"),
        img("mar-3", "1489749798305-4fea3ae63d43", 1600, 1067, "Palm grove at the desert edge", "Palmeraie aux portes du désert")
      ],
      createdAt: "2024-02-15T10:00:00Z",
      updatedAt: "2024-02-15T10:00:00Z"
    }),
    place({
      id: "paris-2023",
      slug: "paris",
      name: { en: "Paris", fr: "Paris" },
      description: {
        en: "Bridges, golden hour on the Seine and the Eiffel Tower sparkling on the hour.",
        fr: "Les ponts, l'heure dorée sur la Seine et la tour Eiffel qui scintille à chaque heure."
      },
      city: "Paris",
      country: { en: "France", fr: "France" },
      countryCode: "FR",
      visitedAt: "2023-11",
      coverMediaId: "par-1",
      media: [
        img("par-1", "1502602898657-3e91760cbb34", 1200, 1500, "The Eiffel Tower at sunset", "La tour Eiffel au coucher du soleil"),
        img("par-2", "1499856871958-5b9627545d1a", 1600, 1067, "Pont Alexandre III", "Le pont Alexandre-III"),
        img("par-3", "1431274172761-fca41d930114", 1200, 1600, "The tower from the gardens", "La tour depuis les jardins")
      ],
      createdAt: "2023-11-05T10:00:00Z",
      updatedAt: "2023-11-05T10:00:00Z"
    }),
    place({
      id: "iceland-2023",
      slug: "iceland",
      name: { en: "Northern Iceland", fr: "Nord de l'Islande" },
      description: {
        en: "Endless winter nights, and then — without warning — the sky started to dance.",
        fr: "D'interminables nuits d'hiver, puis — sans prévenir — le ciel s'est mis à danser."
      },
      city: "Akureyri",
      country: { en: "Iceland", fr: "Islande" },
      countryCode: "IS",
      visitedAt: "2023-01",
      coverMediaId: "ice-1",
      media: [
        img("ice-1", "1531366936337-7c912a4589a7", 1600, 1067, "Northern lights over the snow", "Aurore boréale sur la neige"),
        img("ice-2", "1504893524553-b855bce32c67", 1200, 1500, "A canyon of moss and stone", "Un canyon de mousse et de pierre")
      ],
      createdAt: "2023-01-20T10:00:00Z",
      updatedAt: "2023-01-20T10:00:00Z"
    })
  ];

  window.TM = window.TM || {};
  window.TM.mock = {
    profile: {
      schemaVersion: 1,
      ownerId: "dovene",
      username: "dovene",
      displayName: "Travel Memories",
      description: { en: "Places, moments and memories.", fr: "Lieux, instants et souvenirs." }
    },
    places: { schemaVersion: 1, places: places },
    heroSlides: [
      { mediaId: "dol-1", slug: "dolomites" },
      { mediaId: "san-1", slug: "santorini" },
      { mediaId: "kyo-1", slug: "kyoto" },
      { mediaId: "ice-1", slug: "iceland" }
    ]
  };
})();
