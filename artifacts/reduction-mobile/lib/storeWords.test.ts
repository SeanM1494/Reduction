import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manageRoute, STORE_WORDS, storeHostOf, storeOfProvider } from './storeWords';

test('the iOS words are the sentences the app said before Android existed', () => {
  // These strings reach iPhones in an OTA update; a change here is a change
  // to the shipping app's copy, so it must be a deliberate one.
  assert.equal(STORE_WORDS.ios.store, 'App Store');
  assert.equal(STORE_WORDS.ios.account, 'Apple ID');
  assert.equal(STORE_WORDS.ios.manageWhere, 'Settings › Apple Account › Subscriptions');
  assert.equal(
    STORE_WORDS.ios.renewalTerms,
    'Renews automatically until cancelled. Manage or cancel in your App Store account settings.'
  );
});

test('a host is Android only when the platform says so', () => {
  assert.equal(storeHostOf('android'), 'android');
  assert.equal(storeHostOf('ios'), 'ios');
  assert.equal(storeHostOf('web'), 'ios');
});

test('the provider values are the ones the server writes', () => {
  assert.equal(STORE_WORDS.ios.provider, 'apple');
  assert.equal(STORE_WORDS.android.provider, 'google_play');
  assert.equal(storeOfProvider('apple'), 'ios');
  assert.equal(storeOfProvider('google_play'), 'android');
  assert.equal(storeOfProvider('stripe'), null);
  assert.equal(storeOfProvider(null), null);
});

test('a subscription is managed here only from the store that sold it', () => {
  assert.equal(manageRoute('apple', 'ios'), 'here');
  assert.equal(manageRoute('google_play', 'android'), 'here');
  assert.equal(manageRoute('apple', 'android'), 'store');
  assert.equal(manageRoute('google_play', 'ios'), 'store');
  assert.equal(manageRoute('stripe', 'ios'), 'website');
  assert.equal(manageRoute(null, 'android'), 'website');
});
