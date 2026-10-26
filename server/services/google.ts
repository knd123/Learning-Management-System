import { OAuth2Client } from 'google-auth-library';

/** Who a "Sign in with Google" token belongs to. */
export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
}

/** Checks "Sign in with Google" ID tokens issued for one OAuth client. Swapped for a fake in tests. */
export interface GoogleSignIn {
  readonly clientId: string;
  verify(idToken: string): Promise<GoogleIdentity>;
}

export class GoogleIdTokenVerifier implements GoogleSignIn {
  private readonly client = new OAuth2Client();

  constructor(readonly clientId: string) {}

  /** Checks Google's signature, the issuer, the expiry and that the token was made for this app. */
  async verify(idToken: string): Promise<GoogleIdentity> {
    const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
    const payload = ticket.getPayload();
    if (!payload?.email) throw new Error('The Google token has no email address.');
    return { email: payload.email.toLowerCase(), emailVerified: payload.email_verified === true };
  }
}
