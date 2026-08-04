require("@nomicfoundation/hardhat-toolbox");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      // InvoiceRegistry and the Flare periphery interfaces.
      {
        version: "0.8.25",
        settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
      },
      // The FCC scaffold's contracts pin ^0.8.27.
      {
        version: "0.8.27",
        settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
      },
    ],
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    coston2: {
      url: process.env.COSTON2_RPC || "https://coston2-api.flare.network/ext/C/rpc",
      chainId: 114,
      accounts,
    },
    songbird: {
      url: process.env.SONGBIRD_RPC || "https://songbird-api.flare.network/ext/C/rpc",
      chainId: 19,
      accounts,
    },
  },
  etherscan: {
    apiKey: { coston2: "empty" },
    customChains: [
      {
        network: "coston2",
        chainId: 114,
        urls: {
          apiURL: "https://coston2-explorer.flare.network/api",
          browserURL: "https://coston2-explorer.flare.network",
        },
      },
    ],
  },
};
