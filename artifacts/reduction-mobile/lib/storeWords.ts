/**
 * lib/storeWords.ts — what each store is called, in the sentences the app
 * shows, and which subscription provider it is.
 *
 * The purchase seam (lib/purchase.ts) keeps WHO sells out of every caller;
 * this keeps the store's NAME out of them. An iPhone says "App Store",
 * "Apple ID" and "Settings › Apple Account › Subscriptions"; an Android
 * phone says "Google Play", "Google account" and the Play Store's own
 * subscriptions page. Every one of those sentences existed for iOS before
 * Android did, and the iOS strings here are those sentences verbatim —
 * storeWords.test.ts pins them, because an OTA update carrying this file
 * reaches iPhones first.
 *
 * `provider` is the value the server writes in `subscriptions.provider`
 * for a purchase made in that store. It is read only to decide whether a
 * subscription is managed HERE (this phone's own store page) or somewhere
 * else, never to branch behaviour on a provider.
 *
 * PURE ON PURPOSE (no react-native import), so the runner tests it.
 */

export type StoreHost = 'ios' | 'android';

export interface StoreWords {
  /** subscriptions.provider for a purchase made in this store. */
  provider: 'apple' | 'google_play';
  /** "the App Store" reads wrong for Google Play, so the article is not here. */
  store: string;
  /** The store as the subject of a sentence: "The App Store", "Google Play". */
  theStore: string;
  /** Whose purchases a restore looks through. */
  account: string;
  /** Where the person cancels it themselves. */
  manageWhere: string;
  /** Beside a price (Apple 3.1.2; Play asks the same of a subscription). */
  renewalTerms: string;
}

export const STORE_WORDS: Record<StoreHost, StoreWords> = {
  ios: {
    provider: 'apple',
    store: 'App Store',
    theStore: 'The App Store',
    account: 'Apple ID',
    manageWhere: 'Settings › Apple Account › Subscriptions',
    renewalTerms: 'Renews automatically until cancelled. Manage or cancel in your App Store account settings.',
  },
  android: {
    provider: 'google_play',
    store: 'Google Play',
    theStore: 'Google Play',
    account: 'Google account',
    manageWhere: 'the Play Store › Payments & subscriptions › Subscriptions',
    renewalTerms: 'Renews automatically until cancelled. Manage or cancel in the Play Store under Payments & subscriptions.',
  },
};

/** react-native's Platform.OS, read as a store. Anything that is not
 *  Android words itself as the App Store, which is what every surface said
 *  before Android existed. */
export const storeHostOf = (os: string): StoreHost => (os === 'android' ? 'android' : 'ios');

/** The store a provider value names, or null for a provider that is not a
 *  store (the website's). */
export function storeOfProvider(provider: string | null | undefined): StoreHost | null {
  if (provider === STORE_WORDS.ios.provider) return 'ios';
  if (provider === STORE_WORDS.android.provider) return 'android';
  return null;
}

/**
 * How an active subscription is managed from THIS phone:
 *  - 'here'    bought in this phone's store: open that store's page.
 *  - 'store'   bought in the OTHER store: only that store can manage it,
 *              so the app says where rather than opening the wrong page.
 *  - 'website' bought on the web.
 */
export function manageRoute(provider: string | null | undefined, host: StoreHost): 'here' | 'store' | 'website' {
  const store = storeOfProvider(provider);
  if (store === host) return 'here';
  if (store) return 'store';
  return 'website';
}
