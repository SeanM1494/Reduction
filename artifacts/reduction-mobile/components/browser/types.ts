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
  canGoForward: boolean;
  /** Why the page could not be shown, or null. */
  failed: string | null;
  /** Is there a recipe on it (lib/pageCapture.ts `looksLikeRecipe`)? Null
   *  until the page has been asked, or when it could not be — unknown is
   *  never treated as "no". */
  recipe: boolean | null;
}

export interface PageViewHandle {
  /** The rendered page, stripped for sending (lib/pageCapture.ts). */
  capture(): Promise<CaptureResult>;
  /** Ask the page now, for an answer about what it shows at this moment. */
  detect(): Promise<boolean | null>;
  goBack(): void;
  goForward(): void;
  reload(): void;
}

export interface PageViewProps {
  url: string;
  /** Keep no cookies or site data once the view is gone. */
  incognito?: boolean;
  onState(state: PageState): void;
}
