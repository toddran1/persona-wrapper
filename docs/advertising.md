# Advertising foundation

Advertising eligibility comes only from the authenticated account's billing
catalog `currentPlanId`. Bronze is ad-supported; Silver and Gold never mount,
initialize, preload, or request ads.

## Web

`BronzeBannerAd` is placed at the bottom of the conversation sidebar. The
AdSense loader and slot are created only after the authenticated account's
authoritative billing catalog confirms Bronze and
`VITE_ADSENSE_BRONZE_AD_SLOT` is configured. If the catalog request fails, the
loader and ad remain unmounted. Ad requests start paused and explicitly request
non-personalized treatment. The slot resumes only after Google's published web
consent message reports that applicable consent data is ready; when GDPR
applies, a denial of storage access keeps the request paused.
The static `google-adsense-account` meta tag verifies publisher ownership
without loading the advertising runtime for ineligible or signed-out visitors.

Before enabling the slot in production, publish the site's European regulations
message in AdSense **Privacy & messaging**, associate it with the production
domain and `/privacy` URL, and enable consent-mode support. Also configure the
applicable US-state message. Test the published message and both consent choices
in a clean browser profile before release. The legal policy links to Google's
partner-data explanation and Ads Settings, while the site remains responsible
for keeping the live message, selected ad technology providers, and policy text
aligned.

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

`EXPO_PUBLIC_ADS_MODE` independently controls which placement identifiers the
app requests. `development`, `preview`, `play-internal`, and `testflight` EAS
profiles set it to `test` and always use Google's official test banner and
rewarded identifiers. The `play-internal-ssv` and `testflight-ssv` profiles set
it to `ssv-test`: banners remain on Google's demo unit, while rewarded ads use
the app's configured unit so its AdMob SSV callback runs. SSV test builds require
one or more comma-separated AdMob test-device hashes in
`EXPO_PUBLIC_ADMOB_TEST_DEVICE_IDS`; request configuration marks those devices
as test traffic before the SDK initializes. Only the public `production`
profile sets the mode to `production`. Native configuration rejects SSV test or
production modes outside the production app environment and fails closed when
required IDs are absent.

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
placing ads. Eligible Bronze accounts refresh UMP consent once per app launch,
and **Settings → About → Privacy choices** opens Google's privacy-options form
when the SDK says an entry point is required.

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
for 400 days before scheduled cleanup. The endpoint returns a no-reward `200`
response for AdMob's queryless URL-readiness probe. Signed console callbacks
without the optional testing identity fields are verified and acknowledged but
never enter the reward transaction. Invalid 400-class callbacks are also
acknowledged without a grant; temporary key-service failures remain retryable
non-200 responses.

## app-ads.txt

The AdMob authorized-seller record is published at:

`https://<developer-domain>/app-ads.txt`

This is separate from the web app's AdSense `/ads.txt` file.
