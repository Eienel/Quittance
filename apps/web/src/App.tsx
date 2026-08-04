import { Link, Outlet } from "react-router-dom";
import { useWallet } from "@/hooks/useWallet";
import { useFixtures } from "@/lib/fixtures";
import { CHAIN } from "@/lib/config";

export default function App() {
  const wallet = useWallet();
  const fixtures = useFixtures();

  return (
    <>
      <nav>
        <Link to="/" className="brand">Quittance</Link>
        <Link to="/">Invoices</Link>
        <Link to="/create">Create</Link>
        <Link to="/record">Record</Link>
        <Link to="/score">Score</Link>
        <button onClick={wallet.connect} disabled={wallet.connecting}>
          {wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Connect"}
        </button>
      </nav>

      <main>
        {fixtures && (
          <p className="dim">
            Fixture mode — all data is fake. Remove <code>?fixtures=1</code> to read {CHAIN.name}.
          </p>
        )}
        {wallet.error && <p className="error">{wallet.error}</p>}
        {wallet.address && !wallet.isCorrectChain && (
          <p className="error">Wrong network — switch to {CHAIN.name}.</p>
        )}
        <Outlet context={wallet} />
      </main>
    </>
  );
}
