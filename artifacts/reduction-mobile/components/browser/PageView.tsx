/**
 * components/browser/PageView.tsx — the page itself, on the phone: a
 * WKWebView (react-native-webview), the engine Safari uses, on the phone's
 * own connection. That is the whole point: a site that refuses every
 * server sees a person reading its page (ROADMAP, the in-app browser).
 *
 * Four rules:
 *  - Only web pages load. An app link, mailto: or tel: is refused rather
 *    than handed to another app from inside a recipe.
 *  - A link that opens a new window loads here instead (WKWebView's
 *    default when no window handler is given).
 *  - If WebKit's page process is killed (memory pressure on a heavy page),
 *    the page reloads rather than leaving a blank view.
 *  - The capture is a string injected into the page and answered through
 *    the bridge with a nonce (lib/pageCapture.ts); a reply that is not the
 *    answer to the current capture is ignored.
 *
 * The user agent is WKWebView's own. Identifying as Safari is a knob
 * (`applicationNameForUserAgent`) left unturned until a real site proves it
 * is needed — ROADMAP says why that is a choice, not a default.
 */

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { captureScript, isWebUrl, newNonce, readCaptureMessage, type CaptureResult } from '@/lib/pageCapture';
import type { PageViewHandle, PageViewProps } from './types';

const CAPTURE_TIMEOUT_MS = 10_000;

export const PageView = forwardRef<PageViewHandle, PageViewProps>(function PageView({ url, incognito = true, onState }, ref) {
  const web = useRef<WebView>(null);
  const pending = useRef<{ nonce: string; resolve: (r: CaptureResult) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const state = useRef({ url, title: '', loading: true, progress: 0, canGoBack: false, failed: null as string | null });
  const report = (patch: Partial<typeof state.current>) => {
    state.current = { ...state.current, ...patch };
    onState(state.current);
  };

  useImperativeHandle(ref, () => ({
    capture() {
      pending.current?.resolve({ ok: false, error: 'Superseded.' });
      if (pending.current) clearTimeout(pending.current.timer);
      const nonce = newNonce();
      return new Promise<CaptureResult>((resolve) => {
        const timer = setTimeout(() => {
          if (pending.current?.nonce !== nonce) return;
          pending.current = null;
          resolve({ ok: false, error: 'The page did not answer. Wait for it to finish loading and try again.' });
        }, CAPTURE_TIMEOUT_MS);
        pending.current = { nonce, resolve, timer };
        web.current?.injectJavaScript(captureScript(nonce));
      });
    },
    goBack: () => web.current?.goBack(),
    reload: () => web.current?.reload(),
  }));

  const onMessage = (e: WebViewMessageEvent) => {
    const p = pending.current;
    if (!p) return;
    const got = readCaptureMessage(e.nativeEvent.data, p.nonce);
    if (!got) return;
    clearTimeout(p.timer);
    pending.current = null;
    p.resolve(got);
  };

  const onNav = (n: WebViewNavigation) =>
    report({ url: n.url, title: n.title ?? '', loading: n.loading ?? false, canGoBack: n.canGoBack, failed: null });

  return (
    <WebView
      ref={web}
      source={{ uri: url }}
      style={styles.web}
      incognito={incognito}
      originWhitelist={['http://*', 'https://*', 'about:*']}
      onShouldStartLoadWithRequest={(r) => isWebUrl(r.url)}
      onNavigationStateChange={onNav}
      onLoadStart={() => report({ loading: true, failed: null })}
      onLoadProgress={(e) => report({ progress: e.nativeEvent.progress })}
      onLoadEnd={() => report({ loading: false, progress: 1 })}
      onError={(e) => report({ loading: false, failed: e.nativeEvent.description || 'The page could not be opened.' })}
      onContentProcessDidTerminate={() => web.current?.reload()}
      onMessage={onMessage}
      allowsBackForwardNavigationGestures
      setSupportMultipleWindows={false}
      decelerationRate="normal"
      testID="browser-page"
    />
  );
});

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: 'transparent' } });
