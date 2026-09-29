import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,            // true for 465, false for 587 (STARTTLS)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    connectionTimeout: 10000,  // 10s to connect
    greetingTimeout: 10000,    // 10s for SMTP greeting
    socketTimeout: 15000,      // 15s for socket inactivity
  });

  return transporter;
}

export async function sendEmail({ to, subject, text, html, replyTo }) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || "team@prismgrc.co";

  const transport = getTransporter();

  if (!transport) {
    console.log(`[email disabled] To: ${to}; Subject: ${subject}; ${text}`);
    return { skipped: true };
  }

  const mailOptions = {
    from,
    to,
    subject,
    text,
  };

  if (html) {
    mailOptions.html = html;
  }

  if (replyTo) {
    mailOptions.replyTo = replyTo;
  }

  const info = await transport.sendMail(mailOptions);
  console.log(`[email sent] To: ${to}; Subject: ${subject}; MessageId: ${info.messageId}`);
  return { sent: true, messageId: info.messageId };
}
