# Mobile release readiness

This checklist covers the accessibility, localization, and connectivity gates for the iOS and Android releases.

## Automated gate

Run before every store build:

```bash
npm run verify:release -w @persona/mobile
```

The gate runs TypeScript and the mobile accessibility audit. The audit rejects unlabeled interactive controls, inputs without accessible names, images without descriptions or decorative treatment, and modals that do not identify themselves as modal content.

## Accessibility acceptance

Test the release build on a physical iPhone and Android phone.

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

## Native build note

`expo-localization` and NetInfo include native modules. Install pods/dependencies through a fresh native build before physical-device verification:

```bash
npm run ios -w @persona/mobile
npm run android -w @persona/mobile
```

Store candidates should be tested as release builds, not only through Metro or a development client.
