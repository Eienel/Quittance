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
  const [deployer] = await ethers.getSigners();

  console.log(`network:  ${network.name}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(
    `verifier: ${override === ethers.ZeroAddress ? "FlareContractRegistry (runtime lookup)" : override}`
  );

  const registry = await (
    await ethers.getContractFactory("InvoiceRegistry")
  ).deploy(override);
  await registry.waitForDeployment();

  console.log(`InvoiceRegistry: ${await registry.getAddress()}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
