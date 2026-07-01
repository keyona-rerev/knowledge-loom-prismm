// Provider selection. The single seam where a provider is chosen.
// PUBLISH_PROVIDER defaults to 'zernio'. Adding a provider = one case here.

import type { Publisher } from "./publisher.ts";
import { ZernioPublisher } from "./zernio.ts";

export type { Publisher, PublishInput, PublishResult, PostAnalytics, SocialAccount, ConnectStart, ConnectStartInput } from "./publisher.ts";

export function getPublisher(): Publisher {
  const provider = Deno.env.get("PUBLISH_PROVIDER") ?? "zernio";
  switch (provider) {
    case "zernio":
      return new ZernioPublisher(Deno.env.get("ZERNIO_API_KEY") ?? "");
    default:
      throw new Error(`Unknown PUBLISH_PROVIDER: ${provider}`);
  }
}
