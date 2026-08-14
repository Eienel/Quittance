const { ethers, network } = require("hardhat");

/**
 * Deploys ScoreInstructionSender and registers it as a Flare Compute Extension.
 *
 * Registration on the FlareTeeManager diamond is permissionless: `register()`
 * returns a fresh extension id owned by the caller, who then allowlists their own
 * TEE machine owners. Nothing here needs Foundation approval.
 */
const FLARE_TEE_MANAGER = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE"; // Coston2

const DIAMOND_ABI = [
  "function register(address stateVerifier, address instructionsSender) returns (uint256)",
  "function nextPublicExtensionId() view returns (uint256)",
  "function getTeeExtensionInstructionsSender(uint256 extensionId) view returns (address)",
  "function addAllowedTeeMachineOwners(uint256 extensionId, address[] owners)",
  "function isAllowedTeeMachineOwner(uint256 extensionId, address owner) view returns (bool)",
  "event TeeExtensionRegistered(uint256 indexed extensionId, address indexed owner)",
];

async function main() {
  const invoiceRegistry = process.env.INVOICE_REGISTRY;
  if (!invoiceRegistry) throw new Error("INVOICE_REGISTRY not set");

  const [deployer] = await ethers.getSigners();
  console.log(`network:  ${network.name}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`registry: ${invoiceRegistry}`);

  const sender = await (
    await ethers.getContractFactory("ScoreInstructionSender")
  ).deploy(FLARE_TEE_MANAGER, FLARE_TEE_MANAGER, invoiceRegistry);
  await sender.waitForDeployment();
  const senderAddress = await sender.getAddress();
  console.log(`ScoreInstructionSender: ${senderAddress}`);

  const diamond = new ethers.Contract(FLARE_TEE_MANAGER, DIAMOND_ABI, deployer);

  // The state verifier is optional for this extension - the score is derived
  // from on-chain state the enclave reads itself, so there is no external state
  // commitment to verify.
  const tx = await diamond.register(ethers.ZeroAddress, senderAddress);
  const receipt = await tx.wait();
  console.log(`registered in ${receipt.hash}`);

  // Recover the id the registry assigned us.
  const next = await diamond.nextPublicExtensionId();
  let extensionId = 0n;
  for (let i = 65536n; i < next; i++) {
    if ((await diamond.getTeeExtensionInstructionsSender(i)) === senderAddress) {
      extensionId = i;
      break;
    }
  }
  if (extensionId === 0n) throw new Error("extension id not found after register()");
  console.log(`extensionId: ${extensionId}`);

  // Cache it in the sender so requestScore() can route instructions.
  await (await sender.setExtensionId()).wait();
  console.log(`setExtensionId() done`);

  // Allowlist ourselves as a machine owner, so we can register the TEE machine
  // once the reproducible image is running in Confidential Space.
  await (await diamond.addAllowedTeeMachineOwners(extensionId, [deployer.address])).wait();
  console.log(
    `machine owner allowlisted: ${await diamond.isAllowedTeeMachineOwner(extensionId, deployer.address)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
