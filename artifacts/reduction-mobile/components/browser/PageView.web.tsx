/**
 * components/browser/PageView.web.tsx — the web preview's stand-in for the
 * phone's WKWebView: an iframe. It exists so the flow around the page —
 * the header, the Extract bar, the extraction, the draft — can be driven
 * in a browser. It CANNOT stand in for the phone on the question the
 * feature exists for: a cross-origin page is unreadable from an iframe (and
 * most recipe sites refuse to be framed at all), so here only a page from
 * the app's own origin can be extracted. Whether allrecipes.com loads and
 * extracts is the phone's to answer.
 */

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { CAPTURE_BODY, type CaptureResult } from '@/lib/pageCapture';
import type { PageViewHandle, PageViewProps } from './types';

export const PageView = forwardRef<PageViewHandle, PageViewProps>(function PageView({ url, onState }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const readable = (): Document | null => {
    try {
      return frame.current?.contentDocument ?? null;
    } catch {
      return null;
    }
  };

  useImperativeHandle(ref, () => ({
    async capture(): Promise<CaptureResult> {
      const doc = readable();
      if (!doc) return { ok: false, error: 'The web preview can only read pages from its own site. Try this on the phone.' };
      try {
        const got = new Function('doc', CAPTURE_BODY)(doc) as { url: string; html: string };
        return { ok: true, url: got.url, html: got.html };
      } catch (e) {
        return { ok: false, error: String((e as Error).message || e) };
      }
    },
    goBack: () => {
      try {
        frame.current?.contentWindow?.history.back();
      } catch {
        /* cross-origin: nothing to go back through */
      }
    },
    reload: () => {
      if (frame.current) frame.current.src = frame.current.src;
    },
  }));

  const onLoad = () => {
    const doc = readable();
    onState({
      url: doc?.location?.href ?? url,
      title: doc?.title ?? '',
      loading: false,
      progress: 1,
      canGoBack: false,
      failed: null,
    });
  };

  return (
    <iframe
      ref={frame}
      src={url}
      onLoad={onLoad}
      title="Recipe page"
      data-testid="browser-page"
      style={{ flex: 1, border: 0, width: '100%', height: '100%', background: 'transparent' }}
    />
  );
});
