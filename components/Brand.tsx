// TAT Agency look: teal -> navy gradient taken from the agency logo.
export const brand = {
  accent: "#0f766e",
  accentSoft: "#e3f2f0",
  gradient: "linear-gradient(110deg, #0b4a4d 0%, #0a3550 55%, #0a2a45 100%)",
};

const logoBox = { height: 44, borderRadius: 8, display: "block" } as const;

export function BrandBar({ clientName, clientLogo }: { clientName?: string; clientLogo?: string | null }) {
  return (
    <div style={{ background: brand.gradient, color: "#fff" }}>
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tat-logo.png" alt="TAT Agency" style={{ ...logoBox, width: "auto" }} />
        {clientName && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{clientName}</span>
            {clientLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clientLogo} alt={clientName} style={{ ...logoBox, width: 44, objectFit: "cover" }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function BrandFooter() {
  return (
    <footer style={{ textAlign: "center", color: "#8a8d91", fontSize: 12, padding: "24px 0 32px", letterSpacing: 1 }}>
      Powered by <strong style={{ color: brand.accent }}>TAT</strong> · Social Media Agency
    </footer>
  );
}
