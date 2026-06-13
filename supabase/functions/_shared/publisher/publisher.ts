// Provider-agnostic publishing interface.
//
// The edge functions depend ONLY on this interface, never on a specific
// provider's wire format. Swapping Zernio for another scheduler later means
// adding one implementation file and flipping PUBLISH_PROVIDER. Nothing in the
// publish/connect flow knows the difference.

export interface ConnectStartInput {
  platform: string; // 'linkedin'
  profileId?: string; // provider container/profile id, if the provider uses one
  redirectUrl: string; // where the provider sends the user back after OAuth
}

export interface ConnectStart {
  authorizationUrl: string; // send the user here to authorize
  connectToken?: string; // short-lived token for manual completion, if any
}

export interface SocialAccount {
  accountId: string; // provider account id used when posting
  platform: string;
  username?: string;
  displayName?: string;
  profileId?: string;
  status?: string;
}

export interface PublishInput {
  text: string;
  platform: string; // 'linkedin'
  accountId: string; // provider account id (from social_connections)
  scheduledFor: string; // ISO-8601 UTC instant from the resolver
  timezone: string; // IANA zone the slot is expressed in
}

export interface PublishResult {
  externalPostId: string; // provider post id (idempotency + reference)
  status: string; // provider status, e.g. 'scheduled'
  raw?: unknown;
}

export interface Publisher {
  readonly name: string;
  // Begin an OAuth connect for a platform; returns the URL to send the user to.
  getConnectUrl(input: ConnectStartInput): Promise<ConnectStart>;
  // List connected accounts (optionally filtered by platform).
  listAccounts(platform?: string): Promise<SocialAccount[]>;
  // The provider's default container/profile id, if it uses one (null otherwise).
  getDefaultProfileId(): Promise<string | null>;
  // Hand a post to the provider's scheduler at scheduledFor.
  publish(input: PublishInput): Promise<PublishResult>;
}
