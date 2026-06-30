-- On-chain anchor receipt for the /proof ledger (applied 2026-07-01).
--
-- The Verify button now LANDS a real validate_stat transaction on devnet (not a
-- read-only .view()), so each anchored bet has an explorer-linkable signature that
-- proves the exact stat reconciled to the on-chain Merkle root. proof_tx holds the
-- settle-endpoint signature (the headline receipt); the base-endpoint signature +
-- both confirmations live in proof_json.
alter table public.spk_bets add column if not exists proof_tx text;
comment on column public.spk_bets.proof_tx is 'Landed on-chain validate_stat tx signature (settle endpoint) — the explorer-linkable proof receipt.';
