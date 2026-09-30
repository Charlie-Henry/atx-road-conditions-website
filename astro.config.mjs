import { defineConfig } from "astro/config";

// Fully static output. Live data is fetched in the browser, so there is
// nothing to rebuild when road conditions change.
//
// SITE and BASE_PATH are set by the GitHub Pages workflow
// (.github/workflows/deploy.yml). Locally they are unset, so `npm run dev`
// serves from "/". To deploy by hand, e.g. to a project site:
//   SITE=https://<username>.github.io BASE_PATH=/<repo-name> npm run build
const site = process.env.SITE;
const base = process.env.BASE_PATH;

export default defineConfig({
  output: "static",
  ...(site ? { site } : {}),
  ...(base ? { base } : {}),
});
