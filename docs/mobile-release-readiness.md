# Mobile release readiness

Subscription setup and validation are documented in
[`billing.md`](./billing.md). Store builds must include both platform-specific
RevenueCat public SDK keys, even when only one platform is being built, so the
same production profile cannot silently ship an incomplete billing setup.

This checklist covers the accessibility, localization, and connectivity gates for the iOS and Android releases.

## Automated gate

Run before every store build:

```bash
npm run verify:release -w @persona/mobile
```

The gate runs TypeScript and the mobile accessibility audit. The audit rejects unlabeled interactive controls, inputs without accessible names, images without descriptions or decorative treatment, and modals that do not identify themselves as modal content.

## Store-candidate profiles

Use store-distribution builds for release testing. Expo Go, development clients,
and the internal-distribution `preview` profile do not exercise the same signing,
permission, and store packaging paths.

```bash
# Google Play internal testing: AAB signed for Play, using the development backend
npx eas-cli build --platform android --profile play-internal

# TestFlight candidate using the production backend
npx eas-cli build --platform ios --profile testflight

# Final store candidates using production services
npx eas-cli build --platform all --profile production
```

The `play-internal` and `testflight` profiles use the EAS `production`
environment. Confirm both RevenueCat public SDK keys are present before each
store build. The production API, web, and Android app-link host values are
pinned in `eas.json`; missing platform billing configuration leaves purchase
controls disabled at runtime.

Before each candidate build, verify variable presence without printing sensitive
values:

```bash
npx eas-cli env:list production --format short
```

Required names:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_WEB_APP_URL`
- `EXPO_PUBLIC_ANDROID_APP_LINK_HOST`
- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
- `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`

The preview API/web URLs are pinned in `eas.json`; the store-testing and
production profiles take their URLs from the EAS production environment. Confirm the Google, Facebook, and Apple
provider dashboards contain Better Auth's exact API callbacks for each backend:
`/api/auth/callback/google`, `/api/auth/callback/facebook`, and
`/api/auth/callback/apple`. Apple's callback must be public HTTPS and registered
on the Services ID associated with the app's primary App ID.

For users who choose Apple's Hide My Email option, configure Sign in with Apple
for Email Communication in the Apple Developer portal. Register the exact
transactional sender used by `GMAIL_SMTP_USER` (or its sending domain), and make
sure the domain passes SPF and DKIM before release so verification, reset, and
account notices reach Apple private relay addresses.

The generated native configuration must also be reviewed before upload:

- Android `targetSdkVersion` and `compileSdkVersion` resolve to API 36.
- Android does not request `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`,
  `READ_MEDIA_AUDIO`, or `READ_EXTERNAL_STORAGE`; occasional attachments use the
  system picker.
- iOS declares microphone and speech-recognition usage, plus add-only photo
  access for saving generated images. It does not declare unused camera, Face ID,
  or photo-library read access.
- iOS enables the Sign in with Apple entitlement and uses Apple's native
  Authentication Services button and nonce-protected ID-token flow. Test Continue,
  Face ID or Touch ID confirmation, and cancellation on a physical device,
  including both Share My Email and Hide My Email on a fresh Apple authorization.
- Android uses Apple's Services ID browser flow and returns through the API's
  registered HTTPS `/api/auth/callback/apple` endpoint. Test both successful
  return and cancellation from a Chrome Custom Tab.
- `ITSAppUsesNonExemptEncryption` is `false` because the app uses standard
  operating-system/provider HTTPS and TLS rather than shipping custom or
  non-exempt cryptography.

## Accessibility acceptance

Test the `testflight` build on a physical iPhone and the `play-internal` AAB from
Google Play's internal track on a physical Android phone. Record device model,
OS version, build ID, date, and pass/fail evidence for every run.

- Complete sign in, open the drawer, search chats, send a message, attach a file, open response actions, and use Settings with VoiceOver and TalkBack.
- Confirm focus enters each modal, remains inside it, and returns to the invoking control after dismissal.
- Confirm icon-only controls announce their action and disabled controls announce their state.
- Test the largest system text setting and 200% display scaling. Text should wrap without hiding primary actions or overlapping the composer.
- Enable Reduce Motion and confirm drawer, persona-stage, and modal transitions remain usable and do not depend on animation to communicate state.
- Verify generated images have useful descriptions while logos and duplicated thumbnail media are not announced twice.
- Test with color correction/grayscale and confirm state is never communicated by color alone.
- Test an external keyboard or switch-control flow for sign in, chat composition, and dialogs.

## Localization

English is the only locale declared to iOS and Android until another catalog is complete. User-facing shared copy lives in `apps/mobile/src/localization/messages.ts`; `LocalizationProvider` supplies typed lookup and interpolation, and preserves the device language tag for date formatting.

To add a locale:

1. Add a complete catalog with the same keys as `englishMessages`.
2. Extend `SupportedLocale` and select the catalog from the device locale with English fallback.
3. Add the locale code to the `expo-localization` plugin in `apps/mobile/app.config.ts`.
4. Test pluralization, long labels, right-to-left layout when applicable, date formatting, VoiceOver/TalkBack pronunciation, and all permission copy.
5. Rebuild both native apps before submitting localized metadata.

Do not declare a store locale while any screen still depends on English fallback for core account, safety, payment, or deletion flows.

## Connectivity acceptance

The app treats offline mode as read-only: the open cached conversation remains visible, while authentication, OAuth, chat submission, uploads, refresh, and pagination wait for connectivity. Reconnection refreshes session and conversation data without signing the user out for a transient network failure.

Test this matrix on both platforms:

- Cold launch online and offline.
- Background online, enable airplane mode, then resume.
- Background offline, restore connectivity, then resume.
- Disconnect during sign in, OAuth return, message submission, upload, image download, and conversation refresh.
- Move between Wi-Fi and cellular during a long-running response.
- Confirm the offline banner is announced, retry is reachable, cached content remains readable, and reconnect does not duplicate a message or upload.
- Confirm an expired or revoked session is handled after connectivity returns rather than being mistaken for an offline failure.

## Store privacy disclosures

Before each App Store or Google Play submission, reconcile the live production
configuration with Apple App Privacy and Google Play Data Safety. The legal
policy is the user-facing explanation; the store forms are separate disclosures
and must match the actual SDKs, providers, permissions, and data flows in the
submitted binary.

The current production disclosure review should include:

- Contact and account identifiers: email address, optional username, OAuth
  identifiers, and account authentication records.
- User content: prompts, chats, conversation memory, feedback, uploaded files,
  images, audio, public or authorized URLs, imported archives, and generated
  media.
- Purchases: product, transaction, entitlement, renewal, expiration, refund,
  cancellation, and storefront information when RevenueCat billing is enabled.
- Usage data: product interaction, persona and provider selections, feature
  usage, token and tool counts, quota reservations and settlements, image
  credits, and generated-audio duration.
- Diagnostics: crash data, performance data, request status, route and trace
  identifiers, and redacted operational logs when telemetry is enabled.
- Device and network data: pseudonymous installation identifiers, IP-derived
  approximate location, abuse-prevention signals, and device or operating-system
  details needed for security, compatibility, and support.

For the present configuration, document these purposes where applicable: app
functionality, personalization, account management, analytics and reliability,
security and fraud prevention, customer support, and purchase administration.
Account records, chats, uploads, usage records, and purchases are generally
linked to the signed-in account. The Service currently states that it does not
sell personal information, use private chats for third-party advertising, or
perform cross-context behavioral advertising. Do not mark data as "not linked"
or "not collected" merely because a processor such as OpenAI, Google Gemini,
Fish Audio, Cloudflare R2, Render, RevenueCat, Apple, or Google receives it on
the application's behalf.

Re-run this review whenever advertising is enabled; a provider, analytics SDK,
permission, billing flow, or retention period changes; or a new data category is
introduced. Keep screenshots or exports of the submitted store answers with the
release record so later policy changes can be compared against the disclosures.

Official references:

- [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/)
- [Google Play Data Safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469)

## Native build note

`expo-localization` and NetInfo include native modules. Install pods/dependencies through a fresh native build before physical-device verification:

```bash
npm run ios -w @persona/mobile
npm run android -w @persona/mobile
```

Store candidates should be tested as release builds, not only through Metro or a development client.
# Mobile update policy

The app uses two complementary update paths:

- EAS Update delivers compatible JavaScript and asset patches. The client downloads these in the background and applies them on the next launch unless the user chooses **Restart now**.
- App Store and Google Play builds deliver native dependency, permission, runtime-version, and binary changes.

The API evaluates native builds using these environment variables:

```text
MOBILE_UPDATE_POLICY_VERSION=1
MOBILE_UPDATE_MESSAGE=A newer version of For the Baddiez is available.
MOBILE_IOS_LATEST_BUILD=0
MOBILE_IOS_MINIMUM_BUILD=0
MOBILE_IOS_STORE_URL=
MOBILE_ANDROID_LATEST_BUILD=0
MOBILE_ANDROID_MINIMUM_BUILD=0
MOBILE_ANDROID_STORE_URL=https://play.google.com/store/apps/details?id=com.forthebaddiez.mobile
```

An installed build below `LATEST_BUILD` receives a dismissible prompt. A build
below `MINIMUM_BUILD` is blocked until updated. Never raise a minimum until the
replacement build is approved and available in that platform's store. Keep the
minimum at `0` while configuring store listings. A nonzero minimum requires a
valid store URL and the API refuses to boot on invalid policy configuration.

Increment `MOBILE_UPDATE_POLICY_VERSION` when materially changing policy. Use
store staged/phased releases before increasing `LATEST_BUILD`, monitor the new
binary, and increase `MINIMUM_BUILD` only for compatibility or security needs.
