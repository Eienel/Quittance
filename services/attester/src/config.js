require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const cfg = {
  // Flare side
  rpc: process.env.COSTON2_RPC || "https://coston2-api.flare.network/ext/C/rpc",
  privateKey: process.env.PRIVATE_KEY,
  registryAddress: process.env.INVOICE_REGISTRY,
  // The canonical FlareContractRegistry, identical on every Flare network.
  flareContractRegistry: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",

  // FDC infrastructure (Coston2 / testnet defaults)
  verifierBase:
    process.env.VERIFIER_BASE || "https://fdc-verifiers-testnet.flare.network",
  verifierApiKey:
    process.env.VERIFIER_API_KEY || "00000000-0000-0000-0000-000000000000",
  daBase: process.env.DA_BASE || "https://ctn2-data-availability.flare.network",
  daApiKey: process.env.DA_API_KEY || "00000000-0000-0000-0000-000000000000",

  // XRPL side
  xrplEndpoint: process.env.XRPL_ENDPOINT || "https://testnet.xrpl-labs.com",
  xrplWss: process.env.XRPL_WSS || "wss://testnet.xrpl-labs.com",
  xrplFaucet:
    process.env.XRPL_FAUCET || "https://faucet.altnet.rippletest.net/accounts",
  xrplSeed: process.env.XRPL_SEED,
};

module.exports = cfg;
