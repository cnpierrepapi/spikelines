// SPIKE packs — buy SPIKES with devnet USDC. The larger packs give more SPIKES
// per dollar (volume bonus, measured against the Starter rate). Prices/amounts
// live here so the buy UI, the on-chain verify route, and the ledger all agree
// on one source of truth. Non-round prices are fine: USDC is 6-decimal, so e.g.
// $3.49 = 3_490_000 base units exactly (see packBaseUnits).
export type Pack = { id: string; usdc: number; spikes: number; label: string; bonus?: string };

export const PACKS: Pack[] = [
  { id: "starter", usdc: 3.49, spikes: 750, label: "Starter" },
  { id: "pro", usdc: 4.89, spikes: 1_250, label: "Pro", bonus: "+19%" },
  { id: "max", usdc: 7.69, spikes: 4_200, label: "Max", bonus: "+154%" },
];

export const USDC_DECIMALS = 6;
export const packById = (id: string): Pack | undefined => PACKS.find((p) => p.id === id);
// USDC base units (6 dp) for a pack — the exact amount the transfer must carry.
export const packBaseUnits = (p: Pack): number => Math.round(p.usdc * 10 ** USDC_DECIMALS);
