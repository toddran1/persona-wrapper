# Advertising foundation

Advertising eligibility comes only from the authenticated account's billing
catalog `currentPlanId`. Bronze is ad-supported; Silver and Gold never mount,
initialize, preload, or request ads.

## Web

The AdSense verification loader remains static in `apps/web/index.html` while
the site is reviewed. `BronzeBannerAd` is ready for a future placement and only
mounts an AdSense slot when `VITE_ADSENSE_BRONZE_AD_SLOT` is configured. After
approval, the loader can be moved behind the same Bronze gate.

Web seller authorization is published at `/ads.txt` from
`apps/web/public/ads.txt`.

## Mobile configuration and privacy

Native EAS builds use these AdMob app IDs:

- `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID`
- `EXPO_PUBLIC_ADMOB_IOS_APP_ID`

Placements use:

- `EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID`
- `EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_ID`
- `EXPO_PUBLIC_ADMOB_IOS_BANNER_ID`
- `EXPO_PUBLIC_ADMOB_IOS_REWARDED_ID`

AdMob app IDs use `ca-app-pub-…~…`; banner and rewarded ad-unit IDs use
`ca-app-pub-…/…`. They are different values and are validated separately.

Development and preview builds always use Google's official test identifiers.
Production builds require native app IDs; missing production placement IDs
disable only the unavailable placement.

The mobile banner appears only after the conversation has at least one
assistant response. It occupies a stable sponsored strip directly above the
composer, outside the scrollable transcript, so it cannot be mistaken for a
persona response. The rewarded offer appears in **Plan & usage** when a Bronze
member has two or fewer media credits remaining and still has total usage
available.

App measurement is delayed, and the ad service initializes only after a Bronze
catalog is loaded and Google UMP says ads may be requested. Requests are
non-personalized. Android `AD_ID` remains blocked deliberately because this
foundation does not access the advertising identifier. ATT is not requested.
Configure the consent messages in AdMob's Privacy & messaging console before
placing ads.

## Rewarded server-side verification

The client earned event is presentation-only and never mutates credits. The
production flow is:

1. The authenticated app creates a distinct 24-hour, single-use reward session
   for each ad attempt. Outstanding sessions are capped by the remaining daily
   reward allowance.
2. That session ID is sent to AdMob as signed callback custom data.
3. AdMob calls `GET /api/advertising/admob/ssv` after the completed ad.
4. The API verifies Google's signature using the current Google AdMob public
   keys and validates timestamp, user identity, ad unit, and custom data.
5. The verified transaction is inserted into `ad_reward_events`; the unique
   `(provider, transaction_id)` index rejects replay.
6. In the same database transaction, the server consumes the reward session,
   adds one bonus media credit to the active monthly balance, and marks the
   event granted. The server enforces a maximum of three grants per UTC day.

Set the rewarded unit IDs on the API as well as the corresponding mobile build
values so the callback can reject rewards from any other placement:

- `ADMOB_ANDROID_REWARDED_AD_UNIT_ID`
- `ADMOB_IOS_REWARDED_AD_UNIT_ID`

Configure each rewarded unit's SSV callback URL in AdMob as
`https://<api-domain>/api/advertising/admob/ssv`. Google verification keys are
cached for 12 hours and refreshed when an unknown key ID arrives. Refreshes are
coalesced and backed off during outages; a previously trusted stale key remains
usable while Google temporarily cannot serve the key list. The public callback
also has a high provider-safe request ceiling, and reward records are retained
for 400 days before scheduled cleanup.

## app-ads.txt

Do not publish `app-ads.txt` until the AdMob account supplies the exact
authorized-seller record and the developer domain is associated with both app
store listings. Once available, publish that record at:

`https://<developer-domain>/app-ads.txt`

This is separate from the web app's AdSense `/ads.txt` file.
