const destinations = [
  // ── Metro Manila ──
  { id: "baclaran", name: "Baclaran", area: "Metro Manila", lat: 14.5362, lng: 120.9972, keywords: ["bac", "parañaque", "taft"] },
  { id: "pasay-rotunda", name: "Pasay Rotunda", area: "Metro Manila", lat: 14.5408, lng: 120.9928, keywords: ["pasay", "rotunda"] },
  { id: "edsa-taft", name: "EDSA-Taft", area: "Metro Manila", lat: 14.5378, lng: 120.9969, keywords: ["edsa", "taft", "lrt"] },
  { id: "vito-cruz", name: "Vito Cruz", area: "Metro Manila", lat: 14.5614, lng: 120.9939, keywords: ["vito"] },
  { id: "buendia", name: "Buendia / Gil Puyat", area: "Metro Manila", lat: 14.5528, lng: 121.0017, keywords: ["buendia", "gil puyat"] },
  { id: "lawton", name: "Lawton", area: "Metro Manila", lat: 14.5936, lng: 120.9817, keywords: ["lawton", "cityhall"] },
  { id: "quiapo", name: "Quiapo", area: "Metro Manila", lat: 14.5985, lng: 120.9831, keywords: ["quiapo", "plaza miranda"] },
  { id: "divisoria", name: "Divisoria", area: "Metro Manila", lat: 14.6061, lng: 120.9689, keywords: ["divi", "tondo"] },
  { id: "kalaw", name: "Kalaw / UN Ave", area: "Metro Manila", lat: 14.5806, lng: 120.9817, keywords: ["kalaw", "un ave", "manila"] },
  { id: "ayala", name: "Ayala Ave", area: "Metro Manila", lat: 14.5547, lng: 121.0244, keywords: ["ayala", "makati", "paseo"] },
  { id: "guadalupe", name: "Guadalupe", area: "Metro Manila", lat: 14.5667, lng: 121.0458, keywords: ["guada", "edsa"] },
  { id: "bgc", name: "BGC / Market! Market!", area: "Metro Manila", lat: 14.5278, lng: 121.0500, keywords: ["bgc", "market", "fort"] },
  { id: "cubao", name: "Cubao", area: "Metro Manila", lat: 14.6220, lng: 121.0520, keywords: ["cubao", "araneta", "gateway"] },
  { id: "philcoa", name: "Philcoa", area: "Metro Manila", lat: 14.6561, lng: 121.0428, keywords: ["philcoa", "commonwealth"] },
  { id: "fairview", name: "Fairview", area: "Metro Manila", lat: 14.7142, lng: 121.0619, keywords: ["fairview", "novaliches"] },
  { id: "sm-north", name: "SM North EDSA", area: "Metro Manila", lat: 14.6569, lng: 121.0317, keywords: ["sm north", "north edsa", "trinoma"] },
  { id: "alabang", name: "Alabang", area: "Metro Manila", lat: 14.4156, lng: 121.0372, keywords: ["alabang", "muntinlupa"] },
  { id: "pitx", name: "PITX", area: "Metro Manila", lat: 14.5125, lng: 120.9892, keywords: ["pitx", "parañaque", "terminal"] },
  { id: "monumento", name: "Monumento", area: "Metro Manila", lat: 14.6611, lng: 120.9833, keywords: ["monumento", "caloocan"] },
  // ── Cavite ──
  { id: "bacoor", name: "Bacoor", area: "Cavite", lat: 14.4581, lng: 120.9650, keywords: ["bacoor", "molino"] },
  { id: "imus", name: "Imus", area: "Cavite", lat: 14.4035, lng: 120.9367, keywords: ["imus"] },
  { id: "dasma", name: "Dasmariñas", area: "Cavite", lat: 14.3294, lng: 120.9367, keywords: ["dasma", "dasmarinas"] },
  { id: "tagaytay", name: "Tagaytay", area: "Cavite", lat: 14.1097, lng: 120.9622, keywords: ["tagaytay"] },
  // ── Laguna ──
  { id: "calamba", name: "Calamba", area: "Laguna", lat: 14.1956, lng: 121.1378, keywords: ["calamba"] },
  { id: "sta-rosa", name: "Santa Rosa", area: "Laguna", lat: 14.3152, lng: 121.1117, keywords: ["santa rosa", "sta rosa"] },
  { id: "binan", name: "Biñan", area: "Laguna", lat: 14.3354, lng: 121.0819, keywords: ["binan", "biñan"] },
  { id: "san-pedro", name: "San Pedro", area: "Laguna", lat: 14.3583, lng: 121.0519, keywords: ["san pedro"] },
  // ── Batangas ──
  { id: "batangas-city", name: "Batangas City", area: "Batangas", lat: 13.7597, lng: 121.0567, keywords: ["batangas city"] },
  { id: "tanauan", name: "Tanauan", area: "Batangas", lat: 14.0864, lng: 121.1528, keywords: ["tanauan"] },
  { id: "lipa", name: "Lipa", area: "Batangas", lat: 13.9410, lng: 121.1619, keywords: ["lipa"] },
  // ── Rizal ──
  { id: "antipolo", name: "Antipolo", area: "Rizal", lat: 14.5867, lng: 121.1750, keywords: ["antipolo"] },
  { id: "cainta", name: "Cainta", area: "Rizal", lat: 14.5819, lng: 121.1167, keywords: ["cainta"] },
  { id: "taytay", name: "Taytay", area: "Rizal", lat: 14.5725, lng: 121.1369, keywords: ["taytay"] },
  // ── Bulacan ──
  { id: "malolos", name: "Malolos", area: "Bulacan", lat: 14.8464, lng: 120.8117, keywords: ["malolos"] },
  { id: "meycauayan", name: "Meycauayan", area: "Bulacan", lat: 14.7350, lng: 120.9594, keywords: ["meycauayan"] },
  { id: "baliuag", name: "Baliuag", area: "Bulacan", lat: 14.9547, lng: 120.8969, keywords: ["baliuag"] },
  // ── Provincial Hubs ──
  { id: "dagupan", name: "Dagupan", area: "Provincial", lat: 16.0433, lng: 120.3333, keywords: ["dagupan", "pangasinan"] },
  { id: "tarlac", name: "Tarlac City", area: "Provincial", lat: 15.4875, lng: 120.5900, keywords: ["tarlac"] },
  { id: "pampanga", name: "San Fernando", area: "Provincial", lat: 15.0333, lng: 120.6833, keywords: ["san fernando", "pampanga"] },
  { id: "naga", name: "Naga", area: "Provincial", lat: 13.6167, lng: 123.1833, keywords: ["naga", "camarines"] },
  { id: "iloilo", name: "Iloilo City", area: "Provincial", lat: 10.6969, lng: 122.5644, keywords: ["iloilo"] },
  { id: "cebu", name: "Cebu City", area: "Provincial", lat: 10.3157, lng: 123.8854, keywords: ["cebu"] },
  { id: "davao", name: "Davao City", area: "Provincial", lat: 7.0700, lng: 125.6000, keywords: ["davao"] },
  { id: "baguio", name: "Baguio", area: "Provincial", lat: 16.4023, lng: 120.5960, keywords: ["baguio"] },
];

export default destinations;
