// On-chain `subscribe` instruction (free WC tier = 0 TxL, only tx fee).
import * as anchorPkg from "@coral-xyz/anchor";
const { AnchorProvider, Program } = anchorPkg;

// Minimal Anchor wallet from a Keypair — anchor's NodeWallet isn't present in
// the bundled ESM build, so we provide the small interface AnchorProvider needs.
function keypairWallet(kp) {
  const sign = (tx) => {
    if (typeof tx.partialSign === "function") tx.partialSign(kp); // legacy Transaction
    else tx.sign([kp]); // VersionedTransaction
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async (tx) => sign(tx),
    signAllTransactions: async (txs) => txs.map(sign),
  };
}
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "./idl/txoracle.json";
import { cfg, SERVICE_LEVEL, DURATION_WEEKS } from "./config.mjs";

export function makeProgram(keypair) {
  const connection = new Connection(cfg.rpc, "confirmed");
  const provider = new AnchorProvider(connection, keypairWallet(keypair), {
    commitment: "confirmed",
  });
  // The shipped IDL address is mainnet; override for the active cluster.
  const idlForCluster = { ...idl, address: cfg.programId.toBase58() };
  const program = new Program(idlForCluster, provider);
  return { connection, provider, program };
}

export async function subscribe(keypair) {
  const { connection, program } = makeProgram(keypair);
  const mint = cfg.txlineMint;

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    keypair,
    mint,
    keypair.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    mint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const txSig = await program.methods
    .subscribe(SERVICE_LEVEL, DURATION_WEEKS)
    .accounts({
      user: keypair.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: mint,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return txSig;
}
