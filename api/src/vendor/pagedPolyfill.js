// Vendored Paged.js polyfill (v0.4.3, MIT — https://pagedjs.org).
//
// The Big-4 self-assessment readiness report (utils/selfAssessmentDocument.js) is
// a full HTML document that uses paged-media CSS — `@page` margin boxes for the
// running header / footer / page numbers, `position: running()` for the PRISM
// letterhead, a repeated watermark, and a cover page. No browser implements
// paged media natively for screen/print of arbitrary content, so we inline this
// polyfill into the generated document. It is deliberately NOT included in the
// compact `report.html` email fragment — only in `report.document`, which is
// opened in a browser tab and printed to PDF.
//
// The .min.js file is the unmodified dist build from `npm pack pagedjs@0.4.3`
// (package/dist/paged.polyfill.min.js). To refresh: re-pack and copy it in.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** The full Paged.js polyfill source, ready to inline inside a <script> tag. */
export const PAGED_POLYFILL = readFileSync(join(here, "paged.polyfill.min.js"), "utf8");
