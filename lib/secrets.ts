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

const key = () => {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is required to store credentials");
  return createHash("sha256").update(`integrations:${s}`).digest();
};

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

function decrypt(stored: string): string | null {
  try {
    const [v, iv, tag, enc] = stored.split(":");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
  } catch {
    return null; // wrong SESSION_SECRET or damaged value: treat as not set
  }
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
    const v = decrypt(String(r.value));
    if (v) next[String(r.name)] = v;
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
