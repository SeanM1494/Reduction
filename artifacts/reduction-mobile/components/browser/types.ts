/**
 * components/browser/types.ts — what the recipe browser's page surface
 * (PageView.tsx on the phone, PageView.web.tsx in the web preview) reports
 * and what it can be asked to do. Its own file so both platform variants
 * and the screen share one definition.
 */

import type { CaptureResult } from '@/lib/pageCapture';

export interface PageState {
  /** Where the page is now — after redirects, and after the person browsed. */
  url: string;
  title: string;
  loading: boolean;
  /** 0–1, for the thin bar under the header. */
  progress: number;
  canGoBack: boolean;
  /** Why the page could not be shown, or null. */
  failed: string | null;
}

export interface PageViewHandle {
  /** The rendered page, stripped for sending (lib/pageCapture.ts). */
  capture(): Promise<CaptureResult>;
  goBack(): void;
  reload(): void;
}

export interface PageViewProps {
  url: string;
  /** Keep no cookies or site data between visits (the rescue path). */
  incognito?: boolean;
  onState(state: PageState): void;
}
