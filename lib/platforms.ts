// Ad platforms a client can have. Meta, TikTok and Google Ads pull live data once the server has their
// credentials; Snapchat stores the client's account id until its integration is switched on.
import { googleConfigured } from "./google";
import { tiktokConfigured } from "./tiktok";

export type PlatformId = "meta" | "google" | "tiktok" | "snapchat";

export const PLATFORMS: { id: PlatformId; label: string; idLabel: string; placeholder: string; hasAdapter: boolean }[] = [
  { id: "meta", label: "Meta Ads", idLabel: "Ad account ID", placeholder: "act_123456789", hasAdapter: true },
  { id: "tiktok", label: "TikTok Ads", idLabel: "Advertiser ID", placeholder: "7000000000000000000", hasAdapter: true },
  { id: "google", label: "Google Ads", idLabel: "Customer ID", placeholder: "123-456-7890", hasAdapter: true },
  { id: "snapchat", label: "Snapchat Ads", idLabel: "Ad account ID", placeholder: "00000000-0000-0000-0000-000000000000", hasAdapter: false },
];

export const platformById = (id: string) => PLATFORMS.find((p) => p.id === id);

// True when the server has the credentials this platform needs to pull data.
export const platformReady = (id: string) => id === "meta" || (id === "tiktok" && tiktokConfigured()) || (id === "google" && googleConfigured());

// Key used as account_id in daily_insights. Meta keeps its plain ad account id (existing data).
export const insightsKey = (platform: string, externalId: string) => (platform === "meta" ? externalId : `${platform}:${externalId}`);
