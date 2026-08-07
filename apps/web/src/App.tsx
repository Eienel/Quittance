import { NavLink, Link, Outlet } from "react-router-dom";
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
        <NavLink to="/" end>Invoices</NavLink>
        <NavLink to="/create">Create</NavLink>
        <NavLink to="/record">Record</NavLink>
        <NavLink to="/score">Score</NavLink>
        <span className="spacer" />
        <span className="chip" title={`${CHAIN.name} · chainId ${CHAIN.id}`}>
          <span className="dot" style={{ background: fixtures ? "var(--lapsed)" : "var(--settled)" }} />
          {fixtures ? "Fixture data" : CHAIN.name}
        </span>
        <button className="ghost" onClick={wallet.connect} disabled={wallet.connecting}>
          {wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Connect"}
        </button>
      </nav>

      <main>
        {fixtures && (
          <p className="dim small" style={{ marginTop: 0 }}>
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
