/**
 * Every address and endpoint the app talks to.
 *
 * All of this is public testnet infrastructure — nothing here is a secret, and
 * the app never handles a private key. Users sign with their own wallet.
 */

export const CHAIN = {
  id: 114,
  idHex: "0x72",
  name: "Flare Testnet Coston2",
  rpc: "https://coston2-api.flare.network/ext/C/rpc",
  explorer: "https://coston2-explorer.flare.network",
  currency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  faucet: "https://faucet.flare.network/coston2",
} as const;

export const CONTRACTS = {
  invoiceRegistry: "0x1267431d069c0F3587dbAA05c41d76e677bFaA4c",
  scoreInstructionSender: "0x3Fa4d7E94a5c28Ab40f2605Fbfc5A8bFd3709347",
  /** Registered Flare Compute Extension id for the confidential scorer. */
  fceExtensionId: 66012,
} as const;

export const XRPL = {
  /**
   * Plain JSON-RPC over POST. CORS-friendly, no API key.
   *
   * A list, tried in order, because public testnet nodes go down or fall out of
   * sync often enough to break a demo. `ledgerNow()` fails over automatically.
   */
  rpcs: [
    "https://testnet.xrpl-labs.com",
    "https://s.altnet.rippletest.net:51234",
  ],
  faucet: "https://faucet.altnet.rippletest.net/accounts",
  explorer: "https://testnet.xrpl.org",
  /** XRPL close times count from 2000-01-01; add this to get Unix seconds. */
  epochOffset: 946_684_800,
  /** Ledgers close roughly this often — used to turn a deadline in minutes into a ledger index. */
  secondsPerLedger: 4,
} as const;

/**
 * How long each stage of an outcome takes, in seconds. The UI should show these
 * rather than hide them: the gap between paying and seeing a receipt is ~2
 * minutes and a bare spinner over that reads as a hang.
 */
export const TIMING = {
  xrplValidation: 4,
  xrplFinality: 12,
  fdcRound: 90,
  fdcRoundWorstCase: 180,
  /** Poll interval for chain reads. Nothing here changes faster than an FDC round. */
  pollMs: 15_000,
} as const;

export const explorerTx = (hash: string) => `${CHAIN.explorer}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${CHAIN.explorer}/address/${addr}`;
export const xrplExplorerTx = (hash: string) => `${XRPL.explorer}/transactions/${hash}`;
export const xrplExplorerAccount = (addr: string) => `${XRPL.explorer}/accounts/${addr}`;
