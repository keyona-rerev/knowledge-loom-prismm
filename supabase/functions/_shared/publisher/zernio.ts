// Zernio implementation of the Publisher interface.
//
// This is the ONLY file that knows Zernio's field names and base URL. The POST
// /v1/posts schema here (content + platforms[{platform, accountId}] + scheduledFor
// + timezone + status) was confirmed against the live API by probe, NOT the
// OpenAPI summary (whose text/socialAccountIds/scheduledAt names the API silently
// ignores). Connect/account shapes are handled defensively across known variants.

import type {
  ConnectStart,
  ConnectStartInput,
  Publisher,
  PublishInput,
  PublishResult,
  SocialAccount,
} from "./publisher.ts";

const BASE_URL = "https://zernio.com/api/v1";

export class ZernioPublisher implements Publisher {
  readonly name = "zernio";
  #apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("ZERNIO_API_KEY is not set");
    this.#apiKey = apiKey;
  }

  async #request(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = body?.error || body?.message || text || `HTTP ${res.status}`;
      throw new Error(`Zernio ${path} failed (${res.status}): ${msg}`);
    }
    return body;
  }

  async getConnectUrl(input: ConnectStartInput): Promise<ConnectStart> {
    const params = new URLSearchParams();
    if (input.profileId) params.set("profileId", input.profileId);
    if (input.redirectUrl) params.set("redirect_url", input.redirectUrl);
    const body = await this.#request(
      `/connect/${encodeURIComponent(input.platform)}?${params.toString()}`,
    );
    const authorizationUrl = body?.authorizationUrl ?? body?.authUrl ?? body?.url;
    if (!authorizationUrl) {
      throw new Error("Zernio connect did not return an authorization URL");
    }
    return { authorizationUrl, connectToken: body?.connectToken ?? body?.state };
  }

  async listAccounts(platform?: string): Promise<SocialAccount[]> {
    const body = await this.#request(`/accounts`);
    const rows: any[] = body?.accounts ?? body?.data ?? [];
    const accounts: SocialAccount[] = rows.map((a) => ({
      accountId: a.accountId ?? a._id ?? a.id,
      platform: a.platform,
      username: a.username,
      displayName: a.displayName ?? a.name,
      profileId: a.profileId,
      status: a.status,
    }));
    return platform ? accounts.filter((a) => a.platform === platform) : accounts;
  }

  async getDefaultProfileId(): Promise<string | null> {
    const body = await this.#request(`/profiles`);
    const rows: any[] = body?.profiles ?? body?.data ?? [];
    if (!rows.length) return null;
    const def = rows.find((p) => p.isDefault) ?? rows[0];
    return def?._id ?? def?.id ?? def?.profileId ?? null;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const payload = {
      content: input.text,
      platforms: [{ platform: input.platform, accountId: input.accountId }],
      scheduledFor: input.scheduledFor,
      timezone: input.timezone,
      status: "scheduled",
    };
    const body = await this.#request(`/posts`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const post = body?.post ?? body;
    const externalPostId = post?._id ?? post?.id;
    if (!externalPostId) {
      throw new Error("Zernio create post returned no post id");
    }
    return { externalPostId, status: post?.status ?? "scheduled", raw: body };
  }
}
