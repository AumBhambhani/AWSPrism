const STATUS_COLORS = {
  OVERDUE:     { bg: "rgba(239,68,68,0.15)",   text: "#ef4444" },
  OPEN:        { bg: "rgba(76,168,160,0.15)",  text: "#4ca8a0" },
  "IN PROGRESS":{ bg: "rgba(96,184,255,0.15)", text: "#60b8ff" },
  SUBMITTED:   { bg: "rgba(168,85,247,0.15)",  text: "#a855f7" },
  COMPLETED:   { bg: "rgba(34,197,94,0.15)",   text: "#22c55e" },
  CANCELLED:   { bg: "rgba(143,163,184,0.15)", text: "#8fa3b8" },
};

function statusBadge(value) {
  const key = String(value).toUpperCase();
  const colors = STATUS_COLORS[key] || { bg: "rgba(143,163,184,0.15)", text: "#8fa3b8" };
  return `<span style="display:inline-block;background:${colors.bg};color:${colors.text};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 10px;border-radius:20px;">${value}</span>`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a branded PRISM HTML email.
 *
 * @param {object} opts
 * @param {string}   opts.heading      - Card heading
 * @param {string}   [opts.preheader]  - Hidden preview text
 * @param {string|string[]} opts.body  - One or more body paragraphs
 * @param {{label:string, value:string, isStatus?:boolean}[]} [opts.details] - Key-value rows
 * @param {{label:string, value:string}} [opts.highlight] - Large display value (e.g. OTP)
 * @param {{text:string, url:string}}  [opts.cta]         - Call-to-action button
 * @param {string}   [opts.note]       - Small note at bottom of card
 */
export function buildEmailHtml({ heading, preheader = "", body, details = [], highlight, cta, note }) {
  const webUrl  = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");
  const logoUrl = `${webUrl}/prism-logo-dark.png`;
  const year    = new Date().getFullYear();
  const appUrl  = webUrl;

  const bodyParagraphs = Array.isArray(body) ? body : [body];
  const bodyHtml = bodyParagraphs
    .map(p => `<p style="margin:0 0 14px;font-size:15px;color:#c8d8e8;line-height:1.7;">${escapeHtml(p)}</p>`)
    .join("");

  const highlightHtml = highlight ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;">
      <tr>
        <td align="center" style="background:#0f1923;border:1px solid #2a3a4a;border-radius:12px;padding:28px 20px;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8fa3b8;">${escapeHtml(highlight.label)}</p>
          <p style="margin:0;font-size:42px;font-weight:700;letter-spacing:0.2em;color:#60b8ff;font-family:'Courier New',Courier,monospace;">${escapeHtml(highlight.value)}</p>
        </td>
      </tr>
    </table>` : "";

  const detailsHtml = details.length > 0 ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #2a3a4a;margin:24px 0 8px;">
      ${details.map(d => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #1e2d3d;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#8fa3b8;width:38%;vertical-align:top;">${escapeHtml(d.label)}</td>
        <td style="padding:12px 0;border-bottom:1px solid #1e2d3d;font-size:14px;color:#c8d8e8;font-weight:500;vertical-align:top;">${d.isStatus ? statusBadge(d.value) : escapeHtml(d.value)}</td>
      </tr>`).join("")}
    </table>` : "";

  const ctaHtml = cta ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr>
        <td align="center">
          <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${escapeHtml(cta.url)}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" fillcolor="#5b8af5"><center><![endif]-->
          <a href="${escapeHtml(cta.url)}"
             style="display:inline-block;background:linear-gradient(135deg,#5b8af5 0%,#a855f7 100%);background-color:#5b8af5;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;text-align:center;min-width:180px;">
            ${escapeHtml(cta.text)}
          </a>
          <!--[if mso]></center></v:roundrect><![endif]-->
        </td>
      </tr>
    </table>` : "";

  const noteHtml = note ? `
    <p style="margin:24px 0 0;font-size:13px;color:#8fa3b8;line-height:1.6;text-align:center;">${escapeHtml(note)}</p>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>PRISM</title>
</head>
<body style="margin:0;padding:0;background-color:#0f1923;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0f1923;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:0 0 32px;">
              <a href="${appUrl}" style="display:inline-block;text-decoration:none;">
                <img src="${logoUrl}" alt="PRISM" width="160" style="display:block;width:160px;max-width:160px;height:auto;border:0;" />
              </a>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#1a2736;border-radius:16px;padding:40px 36px;border:1px solid #2a3a4a;">
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#f0f8ff;line-height:1.3;">${escapeHtml(heading)}</h1>
              ${bodyHtml}
              ${highlightHtml}
              ${detailsHtml}
              ${ctaHtml}
              ${noteHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 0 0;">
              <p style="margin:0;font-size:12px;color:#5a6f82;line-height:1.7;">
                This is an automated message from PRISM. Please do not reply directly to this email.
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:#5a6f82;">
                &copy; ${year} PRISM &mdash; <a href="${appUrl}" style="color:#5a6f82;text-decoration:underline;">prismgrc.co</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
