# Mobile E2E

These Maestro flows drive the installed Android and iOS app, not a React Native mock.

1. Start the API in explicit test mode using a LAN-reachable host and an isolated database. Set `APP_TEST_MODE=true`, `TTS_PROVIDER=local`, `AUTH_REQUIRED=true`, `DATABASE_URL` to a local database ending in `_e2e`, `OAUTH_REDIRECT_BASE_URL` to the API's LAN URL, and `WEB_APP_URL` to the web test URL. Test mode also forces the local speech provider as a server-side safeguard, so it must not use ElevenLabs.
2. Build or run the mobile app with `EXPO_PUBLIC_API_URL` set to that same LAN API URL.
3. Connect an Android device with USB debugging or boot an iOS simulator.
4. Run `npm run test:e2e:mobile`.

`01-auth-oauth-and-chat.yaml` covers account creation, chat submission, and background-job initiation. `02-oauth.yaml` validates the deterministic Google callback. Run the same flow with `mobile-auth-oauth-facebook` when validating Facebook separately. `03-account-data-and-recovery.yaml` covers the visible export/import controls plus deletion and restoration.

The browser E2E suite verifies actual export downloads and imported archive parsing. Native photo/file pickers, system share sheets, and audible output require a physical-device acceptance pass because the operating system owns those UI surfaces. Test the following manually on each release candidate: select a photo, select a file, save generated media, share an export, replay audio while other media is playing, then accept/deny the relevant system permissions. Automated E2E intentionally does not request or replay persona audio.
