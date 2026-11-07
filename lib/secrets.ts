import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db, ensureSchema } from "./db";

// Platform credentials entered on the Integrations page. They are stored encrypted (AES-256-GCM, key
// derived from SESSION_SECRET) in the same database the daily GitHub sync reads, so saving here is all
// that is needed: the sync picks them up on its next run. Values in environment variables still work
// as a fallback, and the database wins when both exist.

export type CredField = { name: string; label: string; secret: boolean; help?: string };
export const INTEGRATIONS: { id: "tiktok" | "google"; label: string; intro: string; fields: CredField[] }[] = [
  {
    id: "tiktok",
    label: "TikTok Ads",
    intro: "Access token of the TikTok for Business app, after each client's advertiser account has authorized it.",
    fields: [{ name: "TIKTOK_ACCESS_TOKEN", label: "Access token", secret: true }],
  },
  {
    id: "google",
    label: "Google Ads",
    intro: "From the agency's Google Ads manager (MCC) account and a Google Cloud OAuth client.",
    fields: [
      { name: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Developer token", secret: true, help: "Google Ads → Tools → API Center (manager account)." },
      { name: "GOOGLE_ADS_CLIENT_ID", label: "OAuth client ID", secret: false },
      { name: "GOOGLE_ADS_CLIENT_SECRET", label: "OAuth client secret", secret: true },
      { name: "GOOGLE_ADS_REFRESH_TOKEN", label: "Refresh token", secret: true, help: "Created with the scope https://www.googleapis.com/auth/adwords." },
      { name: "GOOGLE_ADS_LOGIN_CUSTOMER_ID", label: "Manager (MCC) ID", secret: false, help: "Digits only, no dashes. Needed when clients are linked under the manager." },
    ],
  },
];
export const ALL_CRED_NAMES = INTEGRATIONS.flatMap((i) => i.fields.map((f) => f.name));

// The key comes from INTEGRATIONS_KEY (so the GitHub sync can hold it without SESSION_SECRET, which Vercel
// hides once saved as a secret). Values saved earlier with SESSION_SECRET are still read and are re-encrypted
// with the new key the next time the app loads them.
const derive = (s: string) => createHash("sha256").update(`integrations:${s}`).digest();
const primarySecret = () => process.env.INTEGRATIONS_KEY || process.env.SESSION_SECRET || "";
const legacySecret = () => process.env.SESSION_SECRET || "";
export const credentialKeyConfigured = () => Boolean(primarySecret());
const key = () => {
  const s = primarySecret();
  if (!s) throw new Error("INTEGRATIONS_KEY (or SESSION_SECRET) is required to store credentials");
  return derive(s);
};

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

function decryptWith(k: Buffer, stored: string): string | null {
  try {
    const [v, iv, tag, enc] = stored.split(":");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
  } catch {
    return null; // wrong key or damaged value: treat as not set
  }
}

// Returns the value and whether it was only readable with the legacy key (so it should be re-encrypted).
function decrypt(stored: string): { value: string; legacy: boolean } | null {
  if (!primarySecret()) return null;
  const v = decryptWith(key(), stored);
  if (v !== null) return { value: v, legacy: false };
  if (legacySecret() && legacySecret() !== primarySecret()) {
    const old = decryptWith(derive(legacySecret()), stored);
    if (old !== null) return { value: old, legacy: true };
  }
  return null;
}

let overlay: Record<string, string> = {};
let loadedAt = 0;

// Call before reading credentials (pages, actions, the sync script). Cached for 30 seconds.
export async function loadCredentials(force = false) {
  if (!force && Date.now() - loadedAt < 30_000) return;
  await ensureSchema();
  const res = await db.execute("SELECT name, value FROM integration_credentials");
  const next: Record<string, string> = {};
  for (const r of res.rows) {
    const d = decrypt(String(r.value));
    if (!d) continue;
    next[String(r.name)] = d.value;
    if (d.legacy) {
      // Move to the new key so the GitHub sync (which only has INTEGRATIONS_KEY) can read it too.
      await db.execute({ sql: "UPDATE integration_credentials SET value = ? WHERE name = ?", args: [encrypt(d.value), String(r.name)] });
    }
  }
  overlay = next;
  loadedAt = Date.now();
}

export const cred = (name: string): string => overlay[name] || process.env[name] || "";
export const credSource = (name: string): "saved" | "env" | null => (overlay[name] ? "saved" : process.env[name] ? "env" : null);

// value "" keeps what is stored; null removes it.
export async function saveCredentials(values: Record<string, string | null>) {
  await ensureSchema();
  for (const [name, v] of Object.entries(values)) {
    if (!ALL_CRED_NAMES.includes(name)) continue;
    if (v === null) await db.execute({ sql: "DELETE FROM integration_credentials WHERE name = ?", args: [name] });
    else if (v.trim()) {
      await db.execute({
        sql: "INSERT INTO integration_credentials (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
        args: [name, encrypt(v.trim())],
      });
    }
  }
  await loadCredentials(true);
}

export const maskValue = (v: string) => (v.length <= 6 ? "••••" : `••••${v.slice(-4)}`);
