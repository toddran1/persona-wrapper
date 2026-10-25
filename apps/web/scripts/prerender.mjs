import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer, loadEnv } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "dist");
const config = loadEnv("production", root, "VITE_");
const origin = new URL(process.env.VITE_SITE_URL || config.VITE_SITE_URL || "https://for-the-baddiez-web.onrender.com").origin;
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const template = await readFile(resolve(dist, "index.html"), "utf8");
// Vite transforms the same components used by the browser. Effects do not run
// during server rendering, so no authentication, API, or ad requests are made.
const server = await createServer({ root, mode: "production", server: { middlewareMode: true, watch: null, hmr: false, ws: false } });
try {
  const { learnPages, renderLearnPage } = await server.ssrLoadModule("/src/learnPrerender.tsx");
  for (const page of learnPages) {
    const markup = renderLearnPage(page.path);
    if (!markup.includes("<h1") || markup.includes('class="adsbygoogle"')) {
      throw new Error(`Invalid public HTML for ${page.path}`);
    }
    const html = template
      .replace(/<title>.*?<\/title>/s, `<title>${escape(page.title)}</title>\n    <meta name="description" content="${escape(page.description)}" />\n    <link rel="canonical" href="${escape(origin + page.path)}" />`)
      .replace('<div id="root"></div>', `<div id="root" data-prerendered="true">${markup}</div>`);
    const directory = resolve(dist, page.path.slice(1));
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "index.html"), html);
  }
  const urls = ["/", ...learnPages.map((page) => page.path), "/privacy", "/terms", "/support"];
  await writeFile(resolve(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path) => `  <url><loc>${escape(origin + path)}</loc></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(resolve(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  console.log(`Pre-rendered ${learnPages.length} Learn pages; generated sitemap.xml and robots.txt for ${origin}.`);
} finally {
  await server.close();
}
