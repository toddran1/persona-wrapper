# Public Learn hosting

The chat app stays at `/`. The empty conversation includes a visible link to
`/learn`, which is public and does not depend on a running API to show content.

`npm run build -w @persona/web` builds the SPA, then renders the Learn index and
all guide articles using the same React components. The resulting
`dist/learn/**/index.html` files contain the article text, links, title,
description, and canonical URL. React hydrates these files in the browser.
No session lookups or ad requests run during static rendering. Eligible readers
receive the existing article ad after hydration; the index has no ad slot.
Public Learn links use document navigation so page metadata is refreshed and
the advertising script is unloaded when leaving an article.

Set `VITE_SITE_URL` to the public web origin at build time. `render.yaml` sets
separate origins for dev and production. This value determines canonical URLs
and sitemap URLs; the default is the production Render web origin.

The build also writes `dist/sitemap.xml` and `dist/robots.txt`. Sitemap entries
come from the guide list rather than a separately maintained list of articles.
Render's exact Learn rewrites must precede the catch-all SPA rewrite. When
adding a new guide, add its exact rewrite to both web services in `render.yaml`.
Existing static files such as `robots.txt` and `sitemap.xml` are served directly.

Deploy the web build and sync the Blueprint route/environment changes together.
If hosting settings are managed manually, copy the Learn rewrites into the web
service's Redirects/Rewrites settings before its `/*` rule.

After deployment, verify the following without signing in:

- `/` still opens chat and its empty state links to Learn.
- `/learn` and every article display useful text with JavaScript disabled.
- Each article's page source includes its own title and canonical URL.
- `/sitemap.xml` returns XML and `/robots.txt` returns plain text.
- The Learn index, chat, and legal pages do not request ads.

These changes improve public access and crawlability. They do not establish the
cause of an AdSense rejection or guarantee approval.
