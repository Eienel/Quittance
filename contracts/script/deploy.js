const { ethers, network } = require("hardhat");

/**
 * Deploys InvoiceRegistry.
 *
 * On Flare networks the registry resolves FdcVerification through FlareContractRegistry
 * at runtime, so nothing is hardcoded and an FDC upgrade needs no redeploy. Pass
 * FDC_VERIFICATION only to pin a specific verifier (or a mock on a local chain).
 */
async function main() {
  const override = process.env.FDC_VERIFICATION || ethers.ZeroAddress;
  // Which XRPL network this registry accepts proofs about. A proof from the wrong
  // chain can be perfectly valid and completely wrong for us.
  const sourceName = process.env.XRPL_SOURCE || "testXRP";
  const sourceId = ethers.encodeBytes32String(sourceName);
  const [deployer] = await ethers.getSigners();

  console.log(`network:  ${network.name}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(
    `verifier: ${override === ethers.ZeroAddress ? "FlareContractRegistry (runtime lookup)" : override}`
  );
  console.log(`source:   ${sourceName}`);

  const registry = await (
    await ethers.getContractFactory("InvoiceRegistry")
  ).deploy(override, sourceId);
  await registry.waitForDeployment();

  console.log(`InvoiceRegistry: ${await registry.getAddress()}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
