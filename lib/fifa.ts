// Approximate FIFA world ranking by country (lower = stronger). Used to pick the
// "biggest" hero match. Unlisted nations default to 999.
const RANK: Record<string, number> = {
  Argentina: 1, France: 2, Spain: 3, England: 4, Brazil: 5, Portugal: 6, Netherlands: 7, Belgium: 8,
  Italy: 9, Germany: 10, Croatia: 11, Morocco: 12, Colombia: 13, Uruguay: 14, USA: 15, Mexico: 16,
  Switzerland: 17, Senegal: 18, Denmark: 19, Japan: 20, Iran: 21, "South Korea": 22, Australia: 23,
  Austria: 24, Sweden: 25, Wales: 26, Serbia: 27, Poland: 28, Egypt: 29, Algeria: 30, Nigeria: 31,
  Norway: 32, Scotland: 33, "Ivory Coast": 34, Chile: 35, Canada: 36, Cameroon: 37, Tunisia: 38,
  "Costa Rica": 39, Paraguay: 40, Panama: 41, "Saudi Arabia": 42, Ecuador: 43, Ghana: 44, Qatar: 45,
  "South Africa": 46, "Cape Verde": 47, Uzbekistan: 48, Peru: 49, Jordan: 52, "Congo DR": 55,
  "New Zealand": 56, "Bosnia & Herzegovina": 60, Vietnam: 100, Myanmar: 130,
};

export const fifaRank = (name?: string): number => (name && (RANK[name] ?? RANK[name.trim()])) || 999;
