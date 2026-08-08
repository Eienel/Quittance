import { useEffect, useState } from "react";
import { NavLink, Link, Outlet, useLocation } from "react-router-dom";
import { useWallet } from "@/hooks/useWallet";
import { useFixtures } from "@/lib/fixtures";
import { CHAIN } from "@/lib/config";

export default function App() {
  const wallet = useWallet();
  const fixtures = useFixtures();
  const location = useLocation();

  // On the landing the nav floats transparently over the video hero, then goes
  // solid once you scroll past it.
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // close the mobile menu whenever the route changes
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const over = location.pathname === "/" && !scrolled && !menuOpen;

  return (
    <>
      <nav className={over ? "over" : ""}>
        <Link to="/" className="brand">Quittance</Link>
        <div className={`nav-links${menuOpen ? " open" : ""}`}>
          <NavLink to="/invoices">Invoices</NavLink>
          <NavLink to="/create">Create</NavLink>
          <NavLink to="/record">Record</NavLink>
          <NavLink to="/score">Score</NavLink>
        </div>
        <span className="spacer" />
        <span className="chip" title={`${CHAIN.name} · chainId ${CHAIN.id}`}>
          <span className="dot" style={{ background: fixtures ? "var(--lapsed)" : "var(--settled)" }} />
          {fixtures ? "Fixture data" : CHAIN.name}
        </span>
        <button className="ghost" onClick={wallet.connect} disabled={wallet.connecting}>
          {wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Connect"}
        </button>
        <button className="nav-toggle" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? "✕" : "☰"}
        </button>
      </nav>

      <main>
        {fixtures && (
          <p className="dim small" style={{ marginTop: 0 }}>
            Fixture mode. All data is fake. Remove <code>?fixtures=1</code> to read {CHAIN.name}.
          </p>
        )}
        {wallet.error && <p className="error">{wallet.error}</p>}
        {wallet.address && !wallet.isCorrectChain && (
          <p className="error">Wrong network. Switch to {CHAIN.name}.</p>
        )}
        <Outlet context={wallet} />
      </main>
    </>
  );
}
