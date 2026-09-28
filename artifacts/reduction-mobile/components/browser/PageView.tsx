/**
 * components/browser/PageView.tsx — the page itself, on the phone: a
 * WKWebView (react-native-webview), the engine Safari uses, on the phone's
 * own connection. That is the whole point: a site that refuses every
 * server sees a person reading its page (ROADMAP, the in-app browser).
 *
 * NEVER IMPORTED DIRECTLY. react-native-webview throws at import on a
 * binary without its native half (`TurboModuleRegistry.getEnforcing`), so
 * the Browse tab reaches this file only through `loadPageView()`, which
 * checks first (./loadPageView.ts).
 *
 * Five rules:
 *  - Only web pages load. An app link, mailto: or tel: is refused rather
 *    than handed to another app from inside a recipe.
 *  - A link that opens a new window loads here instead (WKWebView's
 *    default when no window handler is given).
 *  - If WebKit's page process is killed (memory pressure on a heavy page),
 *    the page reloads rather than leaving a blank view.
 *  - The capture and the recipe check are strings injected into the page
 *    and answered through the bridge with a nonce (lib/pageCapture.ts); a
 *    reply that is not the answer to the current question is ignored.
 *  - The recipe check runs when a page finishes loading and once more a
 *    moment later (a recipe drawn by the page's own script arrives after
 *    load), and again whenever the screen asks — so the answer is about the
 *    page on screen when Extract is tapped.
 *
 * The user agent is WKWebView's own. Identifying as Safari is a knob
 * (`applicationNameForUserAgent`) left unturned until a real site proves it
 * is needed — ROADMAP says why that is a choice, not a default.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import {
  captureScript,
  detectScript,
  isWebUrl,
  newNonce,
  readCaptureMessage,
  readDetectMessage,
  type CaptureResult,
} from '@/lib/pageCapture';
import type { PageState, PageViewHandle, PageViewProps } from './types';

const CAPTURE_TIMEOUT_MS = 10_000;
const DETECT_TIMEOUT_MS = 3_000;
/** The second look after load, for recipes a page draws with script. */
const DETECT_AGAIN_MS = 1_500;

export const PageView = forwardRef<PageViewHandle, PageViewProps>(function PageView({ url, incognito = true, onState }, ref) {
  const web = useRef<WebView>(null);
  const pending = useRef<{ nonce: string; resolve: (r: CaptureResult) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const asking = useRef<{ nonce: string; resolve: (r: boolean | null) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const again = useRef<ReturnType<typeof setTimeout> | null>(null);
  const state = useRef<PageState>({ url, title: '', loading: true, progress: 0, canGoBack: false, canGoForward: false, failed: null, recipe: null });
  const report = (patch: Partial<PageState>) => {
    state.current = { ...state.current, ...patch };
    onState(state.current);
  };

  /** Ask the page; resolves with its answer, or null (unknown) on no reply. */
  const detect = (): Promise<boolean | null> => {
    if (asking.current) {
      clearTimeout(asking.current.timer);
      asking.current.resolve(null);
    }
    const nonce = newNonce();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (asking.current?.nonce !== nonce) return;
        asking.current = null;
        resolve(null);
      }, DETECT_TIMEOUT_MS);
      asking.current = { nonce, resolve, timer };
      web.current?.injectJavaScript(detectScript(nonce));
    }).then((answer) => {
      report({ recipe: answer as boolean | null });
      return answer as boolean | null;
    });
  };

  useEffect(
    () => () => {
      if (again.current) clearTimeout(again.current);
      if (asking.current) clearTimeout(asking.current.timer);
      if (pending.current) clearTimeout(pending.current.timer);
    },
    []
  );

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
    detect,
    goBack: () => web.current?.goBack(),
    goForward: () => web.current?.goForward(),
    reload: () => web.current?.reload(),
  }));

  const onMessage = (e: WebViewMessageEvent) => {
    const data = e.nativeEvent.data;
    const a = asking.current;
    if (a) {
      const answer = readDetectMessage(data, a.nonce);
      if (answer !== undefined) {
        clearTimeout(a.timer);
        asking.current = null;
        a.resolve(answer);
        return;
      }
    }
    const p = pending.current;
    if (!p) return;
    const got = readCaptureMessage(data, p.nonce);
    if (!got) return;
    clearTimeout(p.timer);
    pending.current = null;
    p.resolve(got);
  };

  const onNav = (n: WebViewNavigation) => {
    const moved = n.url !== state.current.url;
    report({
      url: n.url,
      title: n.title ?? '',
      loading: n.loading ?? false,
      canGoBack: n.canGoBack,
      canGoForward: n.canGoForward,
      failed: null,
      // A new page has not been asked yet.
      ...(moved ? { recipe: null } : {}),
    });
  };

  const onLoadEnd = () => {
    report({ loading: false, progress: 1 });
    void detect();
    if (again.current) clearTimeout(again.current);
    again.current = setTimeout(() => void detect(), DETECT_AGAIN_MS);
  };

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
      onLoadEnd={onLoadEnd}
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
