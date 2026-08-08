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
  const walletLabel = wallet.address
    ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
    : "Connect";

  return (
    <>
      <nav className={`${over ? "over" : ""}${menuOpen ? " menu-open" : ""}`.trim()}>
        <Link to="/" className="brand">Quittance</Link>
        <div className={`nav-links${menuOpen ? " open" : ""}`}>
          <button className="drawer-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <span className="xicon"><i /><i /></span>
          </button>
          <NavLink to="/invoices">Invoices</NavLink>
          <NavLink to="/create">Create</NavLink>
          <NavLink to="/record">Record</NavLink>
          <NavLink to="/score">Score</NavLink>
          <button className="ghost drawer-connect" onClick={wallet.connect} disabled={wallet.connecting}>
            {walletLabel}
          </button>
        </div>
        <span className="spacer" />
        <span className="chip" title={`${CHAIN.name} · chainId ${CHAIN.id}`}>
          <span className="dot" style={{ background: fixtures ? "var(--lapsed)" : "var(--settled)" }} />
          {fixtures ? "Fixtures" : "Coston2"}
        </span>
        <button className="ghost bar-connect" onClick={wallet.connect} disabled={wallet.connecting}>
          {walletLabel}
        </button>
        <button
          className={`nav-toggle${menuOpen ? " open" : ""}`}
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="bars"><i /><i /></span>
        </button>
      </nav>
      {menuOpen && <div className="nav-backdrop" onClick={() => setMenuOpen(false)} />}

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
