import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { CHAIN } from "@/lib/config";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export interface WalletState {
  address: string | null;
  signer: ethers.Signer | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
}

/**
 * Wallet connection, with the Coston2 network add/switch dance.
 *
 * Reads never need this — the app talks to a public RPC directly. Only issuing
 * an invoice or requesting a score requires a signer.
 */
export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    signer: null,
    chainId: null,
    connecting: false,
    error: null,
  });

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setState((s) => ({ ...s, error: "No wallet extension found." }));
      return;
    }
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

      try {
        await provider.send("wallet_switchEthereumChain", [{ chainId: CHAIN.idHex }]);
      } catch (err: any) {
        // 4902 = chain unknown to the wallet; add it, then we're already on it.
        if (err?.error?.code === 4902 || err?.code === 4902) {
          await provider.send("wallet_addEthereumChain", [
            {
              chainId: CHAIN.idHex,
              chainName: CHAIN.name,
              nativeCurrency: CHAIN.currency,
              rpcUrls: [CHAIN.rpc],
              blockExplorerUrls: [CHAIN.explorer],
            },
          ]);
        } else {
          throw err;
        }
      }

      const signer = await provider.getSigner();
      const net = await provider.getNetwork();
      setState({
        address: await signer.getAddress(),
        signer,
        chainId: Number(net.chainId),
        connecting: false,
        error: null,
      });
    } catch (err: any) {
      setState((s) => ({ ...s, connecting: false, error: err?.shortMessage ?? err?.message ?? String(err) }));
    }
  }, []);

  // A wallet can switch accounts or networks under us; reconnect rather than
  // acting on a stale signer.
  useEffect(() => {
    if (!window.ethereum) return;
    const reconnect = () => void connect();
    window.ethereum.on?.("accountsChanged", reconnect);
    window.ethereum.on?.("chainChanged", reconnect);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", reconnect);
      window.ethereum.removeListener?.("chainChanged", reconnect);
    };
  }, [connect]);

  return {
    ...state,
    connect,
    isCorrectChain: state.chainId === CHAIN.id,
  };
}
