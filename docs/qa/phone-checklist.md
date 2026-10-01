# Phone QA checklist

Everything the container cannot check — no WebKit, no phone, no Apple or
Expo hosts — gathered from ROADMAP.md, CLAUDE.md, MOBILE_PARITY.md,
README.md and the session reports up to Sep 30. Duplicates are merged: the
source column names every place an item came from.

**How to read it**

- Run on a **TestFlight build against the deployment**, unless an item says
  a dev build. Expo Go has no StoreKit and no notification handler.
- `Auto:` means the LOGIC is already proven by a named test. The phone is
  still needed for what the test cannot see (a gesture's feel, a native
  sheet, delivery). An item marked **Auto — skip** is covered well enough
  that the phone adds nothing; it is listed so you know it was not forgotten.
- Sources: R = ROADMAP.md, C = CLAUDE.md, MP = MOBILE_PARITY.md,
  RM = README.md.
- Use a **throwaway account** for anything destructive (account deletion,
  purchases you then delete).

Before starting: `GET /api/health` on the deployment says `schema.ok: true`
and its `commit` is the one you expect. If `schema.missing` lists anything,
run that README section's SQL first.

---

## 1. The 10-minute smoke test

The things that would embarrass us on launch day. Do them in this order on
one phone; the whole pass takes about ten minutes plus the timer.

- [ ] **1. Cold launch.** Swipe the app away and open it. *Expect:* the
  plain cream splash (dark `#131110` in dark mode), then the opening
  sequence, then the app. Never a white or black flash. Never a spinner
  before 300ms.
- [ ] **2. Sign in with Google.** *Expect:* signed in, no "That sign-in
  attempt expired". (Three servers are involved; if it fails, compare
  `/api/health` `commit` on the app's host and the deployment.)
- [ ] **3. Sign in with Apple** on a second account or after signing out.
  *Expect:* signed in; your name shows in Settings (Apple sends it only on
  the first authorization, ever).
- [ ] **4. Extract a link** (Find › Add New), e.g. a Serious Eats recipe.
  *Expect:* the five progress lines, then the unsaved preview ("Preview —
  not saved.") within about 30 seconds.
- [ ] **5. Extract pasted text** with a Title typed in. *Expect:* your
  title, not the model's.
- [ ] **6. Extract a photo** with the camera ("Take a photo"). *Expect:*
  the OS permission prompt with OUR wording (not Expo's), then a recipe.
- [ ] **7. Save** from the preview with one tap on "Save to Library".
  *Expect:* it lands in the book the chip named; Settings' plan line
  updates (the free recipe is spent on SAVE, not on extract).
- [ ] **8. Recipe Box: flip.** Library tab, swipe a book left and right,
  past "Room for one more" and back. *Expect:* a real page turn with no
  mirrored text; a quick second swipe never strands the book between two
  empty pages.
- [ ] **9. Recipe Box: carousel.** Swipe up and down between books.
  *Expect:* an endless loop; with two books the other peeks below.
- [ ] **10. Step-by-Step.** Open the recipe, tap "Step-by-Step", go
  through two cards with "Next Step →". *Expect:* the "Before you start"
  card first when the recipe has a preheat; a thumb brushing the left edge
  does NOT pop the screen.
- [ ] **11. Timer notification.** Settings › Timers › "Turn on
  notifications", accept the OS prompt. Start a 1-minute timer in
  Step-by-Step, lock the phone. *Expect:* one notification titled with the
  recipe, body "Time's up — <step>"; tapping it opens the recipe. (Needs
  the APNs key in EAS credentials; arrives only while the deployment is
  awake.)
- [ ] **12. Sandbox purchase.** On an account with its free recipe used,
  buy Monthly from the wall with a Sandbox tester. *Expect:* Apple's
  sheet, then "Subscribed. Unlimited recipes are on." and the wall lifts.
- [ ] **13. Restore.** On a second device (or after deleting and
  reinstalling), Settings › "Restore purchases". *Expect:* "Your
  subscription is back on this account."
- [ ] **14. Coupon.** Mint one (`POST /api/admin/coupon`), type it in
  lowercase in Settings › "Redeem a code". *Expect:* "Added N recipes to
  your account."; a second try is refused.
- [ ] **15. Legal links.** Tap "Terms of Use" and "Privacy Policy" beside
  a price, in Settings and on the sign-in screen. *Expect:* the static
  pages (/terms.html, /privacy.html), NOT the recipe web app.
- [ ] **16. Send feedback.** Settings › "Send feedback". *Expect:* Mail
  opens to admin@recipereduction.com, subject "Reduction feedback", with
  the app version, runtime, update id, iOS version and model under blank
  lines. No account id, no email, no device name.
- [ ] **17. Account deletion** on a throwaway account that holds a sandbox
  subscription. Settings › "Delete account". *Expect:* the warning names
  the App Store subscription; after deleting, "Account deleted" and the
  reminder to cancel in Settings › Apple Account › Subscriptions.
- [ ] **18. Guided demo, signed out.** Sign out. *Expect:* the demo with
  "Start the demo" / "Watch instead"; it does not start by itself. Tap
  through all six steps.

---

## 2. The full list, by screen

### Launch: splash, icon, opening sequence

- [ ] **Icon** on the home screen, in Spotlight, in Settings and in
  TestFlight. *Expect:* the new mark, cream background, no halo at the
  edges. (R "The new icon and splash")
- [ ] **Splash hand-off in light and in dark.** *Expect:* plain `#efe2c8`
  or `#131110`; a dark launch fades to cream over 250ms. Since Cocoa (Oct
  1) a dark launch WITHOUT the sequence steps from the splash's `#131110`
  to the page's `#211a16` — expected until the splash changes in a build;
  note how visible it is. (R opening, "Needs the phone"; R "Dark mode:
  Cocoa")
- [ ] **Full sequence (4.3s)** plays once, on the first launch after
  install. *Auto:* cadence.test.ts. (R opening)
- [ ] **Quick sequence (2.2s)** on a COLD start at most once per 24 hours;
  never on a return from the background. *Auto:* cadence.test.ts — the
  phone checks how it feels over a day.
- [ ] **Skips:** a tap anywhere skips (150ms fade); a notification tap and a
  link skip it; VoiceOver running skips it. (R opening)
- [ ] **Reduce Motion (the OS setting):** the still for 0.5s plus a 0.4s
  crossfade, no motion. (R opening)
- [ ] **The reveal opens a hole** (the animated ClipPath). *Expect:* the
  app appears through the opening. If it does not, that is where to look.
  (R opening)
- [ ] **Frame rate.** Settings › LONG-PRESS "Replay intro" (600ms; owner
  only) opens "Intro testing". Play Full, then read "Last run (full): N fps
  average, N fps worst frame, N of N frames under 55 fps". *Expect:* 55fps
  or better. If it falls short, cut BUBBLES first, then FADE_LEVELS
  (lib/opening/config.ts). Note: the owner match is by email hash; if you
  sign in with Apple's Hide My Email, add your account id to OWNER_IDS.
  (R opening; lib/opening/owner.ts)
- [ ] **Never delayed:** if the app is not ready, the sequence holds on
  the dark bubbling frame up to 1.5s, then reveals. *Auto:* scene.test.ts.
- [ ] **Landing:** signed out → the demo; signed in → the Recipe Box on
  the last book you had open; nothing saved → "Nothing saved yet". Never
  the paywall. *Auto:* destination.test.ts.

### Sign-in screen

- [ ] **Google from a store build** (smoke 2). *Auto:*
  mobileHandoff.db.test.ts, authMobile.test.ts — the store build is the
  phone's. (R TestFlight pass; C "A phone's sign-in touches THREE servers")
- [ ] **Apple** (smoke 3). First check `/api/auth/providers` on the
  deployment says `apple: true`. *Auto:* apple.test.ts covers the JWT and
  the callback; the exchange with Apple has never run anywhere but a
  phone. (R Phase 4; C "Sign in with Apple"; RM)
- [ ] **Cancel a sign-in half way.** *Expect:* "That sign-in was cancelled
  before it finished." *Auto — skip the other six sentences:*
  authErrors.test.ts. (MP 9)
- [ ] **iPhone SE: the top of the sign-in screen.** Known issue: the mark
  sits at y=−12 in Chromium at 320×568. Check whether it is cut off on a
  real SE. (R icon section)
- [ ] **"Back to the guacamole demo"** returns to the demo.

### Guided demo (signed out; Settings › How it works; empty library › See how it works)

- [ ] **All six steps with real taps**, including "Show me" after six idle
  seconds, a wrong tap (the nudge "Tap the highlighted one to go on."),
  Back, Skip and "Watch instead". *Auto:* demoGuide.test.ts (every state
  four taps reach) — the phone checks the feel. (R guided demo)
- [ ] **The last step is revealed:** on step 4 the page scrolls down to
  "rest 10 min" in the finish strip, clear of the card.
- [ ] **VoiceOver:** the card is read, each step is announced as it
  arrives, and a double-tap completes each do-step. (R guided demo)
- [ ] **Reduce Motion:** the ring does not breathe. "Watch instead" jumps
  straight to the end.
- [ ] **Largest text on an SE:** the card still fits (it caps at 1.4×, the
  nudge at 1.2×).
- [ ] **Finish:** "Find a recipe" (signed in) opens Find; "Sign in" (signed
  out) opens sign-in; "Replay" starts again. Nothing is ever saved.

### Find › Add New

- [ ] **Link, text, photo** (smoke 4–6). *Auto:* extractionStage.test.ts
  for the progress lines.
- [ ] **A slow extraction** shows "Still working — taking longer than
  usual" after 45s and keeps waiting up to 180s rather than failing.
  (RM "Extraction speed")
- [ ] **A blocked site** (allrecipes.com) says "This site blocked us…"
  and offers "Open in browser". (R Find)
- [ ] **The Browse hint** ("Some websites don't work…") is one 44pt link
  that opens Browse.
- [ ] **Photos:** a HEIC photo from the library; deny camera access, then
  "Open Settings" works; "Remove". *Auto:* photoSize.test.ts (the
  downscale). (R Phase 1 (c))
- [ ] **Keyboard:** the paste box and the Title/From fields are not
  covered by the keyboard on an SE.
- [ ] **The starter reel ("Try one of these")**, with an account that has
  no recipes (it is also under the empty library's two buttons). *Expect:*
  Recipe Box pages — picture (or meal-type art), title, time, serves and
  steps and ingredients when there is room, the site at the bottom, "👍 N"
  on the picture and "Cooked by N people" only on data-backed cards. On an
  iPhone 13 the whole reel is visible above the tab bar without scrolling
  (Chromium cannot measure this: its layout of that screen runs ~63pt
  taller than the phone's); on a Pro Max, too; on an SE it is below the
  fold. *Auto:* reelView.test.ts (sizes, counts), reel.db.test.ts.
- [ ] **The ticker:** the row drifts left by itself and loops with no seam;
  a finger on it stops it at once; tapping a card opens its preview; it
  drifts again 5s after the last touch. It does NOT move with Reduce
  Motion on (Settings › Accessibility › Motion) or with VoiceOver on, and
  then shows each card once. VoiceOver reads "Title, site, Cooked by N
  people, N likes, button" and never a card twice. *Auto:* the drift,
  hold and resume, measured in Chromium (reelView.test.ts for the rules).
- [ ] **Snapping** after a hand-scroll lands a card at the left edge
  (off under Reduce Motion). Chromium has no snapping at all.

### Find › My Recipes

- [ ] **Search** "parmesan". *Expect:* results from your box; no match
  shows "Nothing in your recipe box matches…" then at most two suggestions
  under "Not in your library…". *Auto:* searchLibrary.db.test.ts,
  recipeBox.test.ts. (R Find)
- [ ] **Opening a suggestion** is a cached link extraction (instant) and
  is walled like any extraction.

### Find › Browse (the in-app browser)

- [ ] **Load the six starter sites**, back/forward, the edge swipe, "Open
  in Safari", the address bar's keyboard. (R Find, "WKWebView itself")
- [ ] **allrecipes.com loads and "Extract this page" works.** *Auto:*
  page.db.test.ts (cached by content, never by URL). (R "Still open")
- [ ] **A non-recipe page** says "No recipe found on this page" with "Try
  anyway". *Auto:* pageCapture.test.ts.
- [ ] **Memory:** switch tabs with a heavy page open, come back; the page
  is still there or reloads cleanly.

### Unsaved preview, Save and the book chooser

- [ ] **One-tap save** (smoke 7), then **save into a new book** from the
  chip: "Save to…" › "Create a new book". *Auto:* books.test.ts,
  books.db.test.ts. (R books)
- [ ] **A blank title** asks for one before Save; the 52pt title row wraps
  cleanly on an SE.
- [ ] **Leaving unsaved** asks "Leave without saving?" with "Save to
  Library" / "Discard".
- [ ] **Tapping a step in a preview** says "Save the recipe to check off
  steps."

### Recipe Box (Library tab)

- [ ] **Flip and carousel** (smoke 8–9). *Auto:* recipeBox.test.ts (commit
  rule, whole spreads, carousel geometry). (C gestures; R Recipe Box)
- [ ] **12 books:** is a book still quick to find, and do 12 dots read as a
  count? (R books, MAX_BOOKS — a judgement, not a pass/fail)
- [ ] **Search in the box.** *Expect:* a result opens its book to the
  spread and outlines the page for about 1.8s; removed recipes never
  match. *Auto:* recipeBox.test.ts.
- [ ] **Preview window** (tap a page): a centred window, the dark scrim
  fades in place (no "wash" rising up the screen), "Diagram" and
  "Step-by-Step" open the recipe on that tab. (C "A dialog that asks
  something is a centred WINDOW")
- [ ] **Rating prompt** after finishing a recipe: "How was <title>?". A 👎
  asks "Take it out of your box?"; "Remove it" shows a toast with Undo for
  5s. It never fires twice within six hours. *Auto:* recipeBox.test.ts,
  syncEngine.test.ts.
- [ ] **Removed recipes** (Settings): "Restore" puts it back in its book;
  "Delete forever" confirms first. Restoring never refunds the free
  recipe. *Auto:* removed.db.test.ts.
- [ ] **Grid style** (Settings › Recipe box style › Grid) switches live.
- [ ] **Photos:** ⋮ › Photo › "Take photo" / "Choose photo"; a fast scroll
  never shows another recipe's photo on a card. *Auto:*
  photoSource.test.ts. (C "A LIST RECYCLES ITS CELLS")
- [ ] **Empty library:** "Nothing saved yet…" with "Find a recipe" and "See
  how it works".

### Recipe screen

- [ ] **No swipe-back in either view:** with the diagram scrolled to its
  left edge, swipe right; in Step-by-Step, brush the left edge. *Expect:*
  the screen stays. (C "The recipe screen has no swipe-back"; R TF pass)
- [ ] **Rename by tapping the title** in the header: the same window as ⋮ ›
  Rename. A long title is cut short before the pencil and never runs under
  "Back" or ⋮. *Auto:* headerTitle.test.ts. (R rename)
- [ ] **Diagram:** tap an ingredient, then an amber step; a finished branch
  folds into a chip; the tail goes to the numbered finish strip; run one
  full cook. *Auto:* collapse.test.ts, progress.test.ts. (R TF pass)
- [ ] **Labels never clip mid-word** ("thread onto v" was the bug), and
  fraction glyphs read at arm's length. (C "Native text inside a box of
  definite height")
- [ ] **Tap feel:** no visible lag on a tap. Use the native Perf Monitor
  (dev build) if it feels slow; the last number was a 110ms worst frame.
  (R Phase 1 (d))
- [ ] **Step-by-Step:** "From the recipe" shows this card's share of the
  source step; "Show the rest of this step" unfolds. Is the ~200-character
  fold right after some real cooking? (R "Still open" — a judgement)
- [ ] **Clear progress** mid Step-by-Step: "Clear all progress on this
  recipe?" › "Clear". *Expect:* back to the first card (the preheat card
  again), scrolled to the top; rating and cooked history kept. *Auto:*
  cookReset.test.ts. (R Clear progress)
- [ ] **Timer in Step-by-Step:** countdown, a haptic and "Time's up";
  leaving and returning shows Start, not a stale alert.
- [ ] **Editor** (⋮ › Edit recipe): the keyboard over the edit sheet; the
  350ms press-and-hold on an ingredient and its haptic; dragging to
  another step with edge auto-scroll. *Auto:* edits.test.ts,
  dragMath.test.ts. (R editor)
- [ ] **Reorder steps** (⋮): the 250ms long-press feel.
- [ ] **Original recipe** (⋮ or the row under the diagram): opens the
  source's wording; a second open does not re-fetch. *Auto:*
  originals.db.test.ts.
- [ ] **Servings, Rating, Meal types** sheets open from ⋮ and close
  cleanly; a menu item that opens another sheet opens it after the menu
  has gone. *Auto — skip the arithmetic:* amounts.test.ts.
- [ ] **Delete recipe** (⋮): "Delete this recipe?" › "Delete recipe".

### Timer notifications

- [ ] **Delivery** (smoke 11) with the app locked, and again in the
  foreground (the banner shows). Tap it with the app running, and again
  from cold. *Auto:* pushPolicy.test.ts, push.db.test.ts (claim, fan-out,
  Expo request shape) — delivery is the phone's. (C timers; R Phase 3/4/B;
  RM)
- [ ] **The Timers card keeps its caveat** ("Alerts arrive while Reduction
  is open or has been used recently…"). Never describe this as background
  notifications.
- [ ] **Denied in iOS Settings:** the card says "Notifications are off for
  Reduction." with how to turn them back on.
- [ ] **Turn off** removes this phone; another account signed in on the
  same phone inherits nothing.

### Purchases and the wall

- [ ] **Monthly and Yearly** both appear with store prices, from the wall
  and from Settings' plan card. If the list is empty, check the bundle id
  in App Store Connect against `app.json` and `APPLE_BUNDLE_ID` FIRST. (C
  "StoreKit finds products by the RUNNING APP'S BUNDLE ID")
- [ ] **Purchase and restore** (smoke 12–13). *Auto:* storeKitFlow.test.ts
  (verify THEN finish, cancel, Ask to Buy, restore), billingApple.db.test.ts.
- [ ] **Renewal notifications:** after a sandbox purchase, the deployment
  log shows `[billing:apple:notifications]` lines within minutes. (R Phase 4)
- [ ] **Renewal line and legal links** beside every price. *Auto:*
  legal.test.ts for the URLs.
- [ ] **The wall on your own account:** set `enforce_override=true` with the
  admin PATCH. *Expect:* the wall on Add New and on Browse's Extract; "Open
  my recipe" still opens your recipe. Clear it after. (Launch turns
  `PAYWALL_ENFORCED` on as the very last step, not before.) *Auto:*
  access.db.test.ts.

### Coupons

- [ ] **Redeem** at the wall ("Have a code?") and in Settings (smoke 14).
  *Auto:* access.db.test.ts (once per account).

### Settings

- [ ] **Account ID › Copy** copies (or opens the share sheet on an old
  binary).
- [ ] **Send feedback** (smoke 16). With no mail account set up on the
  phone, iOS itself says "No Mail Accounts" — expected; the in-app
  fallback (address copied, toast) only fires when no mail app exists.
- [ ] **Manage books:** "Add a book", rename, colour (VoiceOver reads the
  colour names), "Move … up/down", "Delete or merge…". Offline, delete and
  merge are refused with "Connect to the internet to delete or merge
  books." *Auto:* booksQueue.test.ts, books.db.test.ts.
- [ ] **Appearance:** System / Light / Dark / Colorblind switch live.
  *Auto — skip:* themePolicy.test.ts.
- [ ] **Sign out** asks first.
- [ ] **Delete account** (smoke 17). *Auto:* account.db.test.ts (billing
  stopped first, nothing gone when it cannot be) — the native alert is
  the phone's.

### Accessibility, across the app

- [ ] **VoiceOver over the diagram:** cells read like "3 ripe avocados,
  ready", with a checked state; a chip says how many steps it folds;
  nothing is read twice from the pinned column. (MP 10; R TF pass —
  "still owed")
- [ ] **VoiceOver in the Recipe Box:** one element per visible page; next
  and previous page and book actions. *Auto:* recipeBox.test.ts ("the page
  as VoiceOver reads it").
- [ ] **VoiceOver elsewhere:** toasts are announced; the title button is
  "Rename recipe"; the rating is a set of toggles; meal types are radios
  plus checkboxes.
- [ ] **Largest Dynamic Type on an SE:** the guided demo card, the Find
  folder tabs (must not wrap), the sign-in screen, the book pages.
- [ ] **Reduce Motion (OS):** opening → the still; demo halo still;
  windows fade without scaling; a book jump further than one spread is a
  crossfade.
- [ ] **Dark mode** everywhere above: card edges carried by the hairline;
  no white flashes.
- [ ] **Dark mode is Cocoa** (Oct 1): a warm brown page, not near-black;
  diagram cells a step lighter with visible light-brown edges and frame;
  the pinned ingredient column a step lighter again; red ready, green
  done and the green Diagram/Step-by-Step choice as before; Recipe Box
  pages and reel cards cream, a little darker than in light mode; Find's
  back tabs brown with a darker edge; a toast lighter than the page. Read
  it across a counter in a dim kitchen and at full brightness — Chromium
  measured every ratio, not the phone's screen. (R "Dark mode: Cocoa")
- [ ] **Edit a step in dark mode:** the small labels in the edit sheet
  (Time, Temp, Name, Amount…) are readable — they were dark brown on
  dark until Oct 1.

### iOS 26 (Liquid Glass) tab layout

- [ ] **Every tab's top** on iOS 26: Find's folder tabs, the Library's
  book header, Settings. *Expect:* nothing under the notch or status bar.
  Chromium can only ever reach the other layout, so this is phone-only by
  definition. (C "There are TWO tab layouts")
- [ ] **The recipe header** on iOS 26: the centred title button and ⋮.
- [ ] **Dark mode on iOS 26:** the native tab bar and the headers take
  their colours from the system, not from the Cocoa tokens. *Expect:*
  they sit acceptably on the `#211a16` page; report if the tab bar reads
  as a black band.

### Offline

- [ ] **Airplane mode in a recipe**, tap several steps. *Expect:* "No
  connection. Your progress here is kept and will save when it returns.";
  turn the network back on and they save. *Auto:* syncEngine.test.ts —
  the real AppState transition is the phone's. (R offline queue)
- [ ] **Offline longer than five minutes** (or backgrounded that long):
  the taps roll back with "That change could not be saved (No
  connection.). It has been undone."
- [ ] **Cold launch with no network** shows the library from the disk
  cache.

### Two devices on one account

- [ ] **Check steps on both**; un-check on one while the other is stale.
  *Expect:* the union of checks, and the un-check honoured. *Auto:*
  sync.test.ts, syncEngine.test.ts — two real phones prove the focus
  refetch. (C Sync)
- [ ] **Edit the tree on both.** *Expect:* one keeps its edit and says so;
  the other is told at its next foreground.
- [ ] **A timer on B while A finishes one:** B's timer survives.

### Over-the-air updates

- [ ] **After a publish**, close and reopen the app twice. *Expect:* the
  new behaviour on the second launch; the app still talks to the
  deployment (not the dev server). Only ever publish with
  `node scripts/publish-update.mjs`. (RM "Over-the-air updates"; C OTA)
- [ ] **Settings ends with "Version 1.1.0 (build N)"** for everyone.
- [ ] **Owner: Updates from: production / preview** (testing sheet). With
  preview empty: "Preview has no update for this version yet. Staying on
  production." With an update on preview: a restart, then "· preview"
  after the version line and Channel `preview` under *This launch*; Back
  to production restarts onto production. (docs/next-publish.md "Prove the
  switch")
- [ ] **Owner: long-press Replay intro › This launch.** *Expect:* Running
  `Update xxxxxxxx` whose 8 characters start the id `eas update:list`
  printed for the publish, Channel `production`, Runtime version `1.1.0`,
  Published the publish time in UTC, Update error `none`. "Embedded
  bundle" means the update has not run yet; "Waiting" means it is
  downloaded and one more full close and reopen runs it. (R "An
  over-the-air update that did not show")

---

## 3. Not phone checks, but due before launch

- `POST /api/admin/preflight/apple-iap/test-notification?environment=production`
  the day the app is live; "TEST acknowledged" in the deployment log.
  (R Phase 4)
- The Lemon Loaf `[diagram]` trace from a dev build's Metro console, pasted
  back, decides the finish-strip component-join question. (R "Still open")
- There is no Android build: elevation shadows, the monochrome icon and the
  notification icon are untested there.
