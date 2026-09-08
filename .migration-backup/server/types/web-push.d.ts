/**
 * server/types/web-push.d.ts — the four calls of `web-push` this app makes.
 *
 * A hand-written declaration rather than @types/web-push: the DefinitelyTyped
 * package is a second dependency to track for a surface that is one setter,
 * one sender and a key generator, and a narrow local declaration also fails
 * loudly if a future call reaches for something not declared here — which is
 * the behaviour worth having at a boundary that fails silently at runtime.
 */
declare module "web-push" {
  export interface PushSubscriptionLike {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  export interface RequestOptions {
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
    headers?: Record<string, string>;
  }
  export interface VapidKeys {
    publicKey: string;
    privateKey: string;
  }
  export function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string
  ): void;
  export function sendNotification(
    subscription: PushSubscriptionLike,
    payload?: string | Buffer | null,
    options?: RequestOptions
  ): Promise<{ statusCode: number; body: string; headers: unknown }>;
  export function generateVAPIDKeys(): VapidKeys;
  const _default: {
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
    generateVAPIDKeys: typeof generateVAPIDKeys;
  };
  export default _default;
}
