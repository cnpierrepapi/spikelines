// Country name -> flag emoji. Covers World Cup nations; falls back to ⚽.
const FLAGS: Record<string, string> = {
  Argentina: "🇦🇷", Algeria: "🇩🇿", Austria: "🇦🇹", Australia: "🇦🇺",
  Belgium: "🇧🇪", "Bosnia & Herzegovina": "🇧🇦", Brazil: "🇧🇷", Cameroon: "🇨🇲",
  Canada: "🇨🇦", "Cape Verde": "🇨🇻", Chile: "🇨🇱", Colombia: "🇨🇴",
  "Congo DR": "🇨🇩", "Costa Rica": "🇨🇷", Croatia: "🇭🇷", Denmark: "🇩🇰",
  Ecuador: "🇪🇨", Egypt: "🇪🇬", England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", France: "🇫🇷",
  Germany: "🇩🇪", Ghana: "🇬🇭", Iran: "🇮🇷", "Ivory Coast": "🇨🇮",
  Italy: "🇮🇹", Japan: "🇯🇵", Jordan: "🇯🇴", Mexico: "🇲🇽",
  Morocco: "🇲🇦", Myanmar: "🇲🇲", Netherlands: "🇳🇱", "New Zealand": "🇳🇿",
  Nigeria: "🇳🇬", Norway: "🇳🇴", Panama: "🇵🇦", Paraguay: "🇵🇾",
  Peru: "🇵🇪", Poland: "🇵🇱", Portugal: "🇵🇹", Qatar: "🇶🇦",
  "Saudi Arabia": "🇸🇦", Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", Senegal: "🇸🇳", Serbia: "🇷🇸",
  "South Africa": "🇿🇦", "South Korea": "🇰🇷", Spain: "🇪🇸", Sweden: "🇸🇪",
  Switzerland: "🇨🇭", Tunisia: "🇹🇳", Uruguay: "🇺🇾", USA: "🇺🇸",
  Uzbekistan: "🇺🇿", Vietnam: "🇻🇳", Wales: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
};

export function countryFlag(name?: string): string {
  if (!name) return "⚽";
  return FLAGS[name] ?? FLAGS[name.trim()] ?? "⚽";
}
