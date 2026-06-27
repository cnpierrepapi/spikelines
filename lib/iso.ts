// Country name -> ISO2 (matches the flag PNG filenames in /public/flags).
const ISO: Record<string, string> = {
  Argentina: "ar", Algeria: "dz", Austria: "at", Australia: "au", Belgium: "be",
  "Bosnia & Herzegovina": "ba", Brazil: "br", Cameroon: "cm", Canada: "ca", "Cape Verde": "cv",
  Chile: "cl", Colombia: "co", "Congo DR": "cd", "Costa Rica": "cr", Croatia: "hr",
  Denmark: "dk", Ecuador: "ec", Egypt: "eg", England: "gb-eng", France: "fr",
  Germany: "de", Ghana: "gh", Iran: "ir", "Ivory Coast": "ci", Italy: "it",
  Japan: "jp", Jordan: "jo", Mexico: "mx", Morocco: "ma", Myanmar: "mm",
  Netherlands: "nl", "New Zealand": "nz", Nigeria: "ng", Norway: "no", Panama: "pa",
  Paraguay: "py", Peru: "pe", Poland: "pl", Portugal: "pt", Qatar: "qa",
  "Saudi Arabia": "sa", Scotland: "gb-sct", Senegal: "sn", Serbia: "rs", "South Africa": "za",
  "South Korea": "kr", Spain: "es", Sweden: "se", Switzerland: "ch", Tunisia: "tn",
  Uruguay: "uy", USA: "us", Uzbekistan: "uz", Vietnam: "vn", Wales: "gb-wls",
};

export const iso = (name?: string): string => (name && (ISO[name] || ISO[name.trim()])) || "xx";
