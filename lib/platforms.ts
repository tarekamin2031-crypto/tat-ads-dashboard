// Ad platforms a client can have. Meta and TikTok pull live data; Google Ads and Snapchat store the
// client's account id for when their integrations are switched on.
import { tiktokConfigured } from "./tiktok";

export type PlatformId = "meta" | "google" | "tiktok" | "snapchat";

export const PLATFORMS: { id: PlatformId; label: string; idLabel: string; placeholder: string; hasAdapter: boolean }[] = [
  { id: "meta", label: "Meta Ads", idLabel: "Ad account ID", placeholder: "act_123456789", hasAdapter: true },
  { id: "tiktok", label: "TikTok Ads", idLabel: "Advertiser ID", placeholder: "7000000000000000000", hasAdapter: true },
  { id: "google", label: "Google Ads", idLabel: "Customer ID", placeholder: "123-456-7890", hasAdapter: false },
  { id: "snapchat", label: "Snapchat Ads", idLabel: "Ad account ID", placeholder: "00000000-0000-0000-0000-000000000000", hasAdapter: false },
];

export const platformById = (id: string) => PLATFORMS.find((p) => p.id === id);

// True when the server has the credentials this platform needs to pull data.
export const platformReady = (id: string) => id === "meta" || (id === "tiktok" && tiktokConfigured());

// Key used as account_id in daily_insights. Meta keeps its plain ad account id (existing data).
export const insightsKey = (platform: string, externalId: string) => (platform === "meta" ? externalId : `${platform}:${externalId}`);
