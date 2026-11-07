// TAT Agency look: teal -> navy gradient taken from the agency logo. Styles live in globals.css.
export const brand = {
  accent: "#0f766e",
  accentSoft: "#e3f2f0",
  gradient: "linear-gradient(110deg, #0b4a4d 0%, #0a3550 55%, #0a2a45 100%)",
};

export function BrandBar({ clientName, clientLogo, admin }: { clientName?: string; clientLogo?: string | null; admin?: boolean }) {
  return (
    <div className="brandbar">
      <div className="brandbar-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tat-logo.png" alt="TAT Agency" className="brand-logo" />
        {clientName && (
          <div className="client">
            <span className="client-name">{clientName}</span>
            {clientLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clientLogo} alt="" className="client-logo" />
            )}
          </div>
        )}
        {admin && (
          <span className="brand-links">
            <a href="/admin/integrations" className="brand-account">Integrations</a>
            <a href="/admin/account" className="brand-account">My account</a>
          </span>
        )}
      </div>
    </div>
  );
}

export function BrandFooter() {
  return (
    <footer className="footer">
      Powered by <strong>TAT</strong> · Social Media Agency
    </footer>
  );
}

export function ClientHero({ name, logo, platform = "Meta Ads", children }: { name: string; logo?: string | null; platform?: string; children?: React.ReactNode }) {
  return (
    <section className="hero">
      <div className="hero-in">
        <div className="hero-id">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="hero-logo" />
          ) : (
            <div className="hero-logo empty" aria-hidden>{name.slice(0, 1).toUpperCase()}</div>
          )}
          <div>
            <div className="hero-eyebrow">Ads performance · {platform}</div>
            <h1 className="hero-name">{name}</h1>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
