const nodemailer = require('nodemailer');

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function sendWelcomeEmail(guest, code) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[mailer] SMTP not configured — skipping email to ${guest.email}`);
    return { sent: false, reason: 'SMTP not configured' };
  }

  const fromAddress = process.env.FROM_EMAIL || process.env.SMTP_USER;

  // QR encodes the same 4-digit code
  const qrData = encodeURIComponent(code);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${qrData}`;

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: guest.email,
      subject: `You're confirmed, ${guest.name.split(' ')[0]} — We can't wait`,
      html: `
        <div style="font-family: Jost, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; background: #0B3D2E; color: #F6F1E7; border-radius: 10px; overflow: hidden;">
          <div style="background:
              radial-gradient(120% 78% at 50% -10%, rgba(201,162,39,.14), transparent 58%),
              radial-gradient(140% 90% at 50% 120%, rgba(7,42,31,.75), transparent 55%),
              #0B3D2E;
              padding: 40px 24px 32px; text-align: center; border-bottom: 3px solid #C9A227;">
            <div style="width: 84px; height: 84px; margin: 0 auto 24px; border-radius: 50%; border: 1px solid #C9A227; display: table;">
              <div style="display: table-cell; vertical-align: middle; font-family: Georgia, 'Times New Roman', serif; font-size: 26px; color: #E4C874; font-weight: 600;">TO</div>
            </div>
            <p style="font-size: 11px; letter-spacing: .42em; text-transform: uppercase; color: #E4C874; margin: 0 0 16px;">You&rsquo;re invited to celebrate</p>
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 44px; line-height: .95; font-weight: 500; color: #F6F1E7; margin: 0;">Team Odetayo</h1>
            <div style="border-top: 1px solid #C9A227; width: 100px; margin: 22px auto 18px;"></div>
            <p style="font-family: Georgia, serif; font-size: 17px; line-height: 1.4; color: #F6F1E7; margin: 0;">
              Two families, one joyful celebration.<br/>We&rsquo;d love you there.
            </p>
            <p style="font-size: 10px; letter-spacing: .28em; text-transform: uppercase; color: rgba(246,241,231,.66); margin: 18px 0 0;">
              26th April 2026 &middot; 2:00 PM &middot; Epe &amp; Lekki Phase 1
            </p>
          </div>

          <div style="padding: 28px 24px; background: #F6F1E7; color: #22271F;">
            <h2 style="font-family: Georgia, serif; font-size: 22px; font-weight: 600; color: #0B3D2E; margin: 0 0 12px;">We can&rsquo;t wait</h2>
            <p style="font-size: 14px; line-height: 1.6; color: #22271F; margin: 0 0 20px;">
              Thank you, <strong>${guest.name}</strong>, your RSVP is confirmed${guest.plus_one ? ` — and we&rsquo;re delighted you&rsquo;re bringing ${guest.plus_one_name ? '<strong>' + guest.plus_one_name + '</strong>' : 'a guest'}` : ''}. Here&rsquo;s everything you&rsquo;ll need for the door.
            </p>

            <div style="background: #fff; border: 1px solid #ECE3D2; border-radius: 10px; padding: 24px; margin-bottom: 20px; text-align: center;">
              <p style="font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #0B3D2E; margin: 0 0 14px; font-weight: 500;">Your check-in code</p>
              <p style="color: #0B3D2E; font-size: 44px; font-family: 'Courier New', monospace; margin: 0 0 18px; font-weight: 700; letter-spacing: 10px;">${code}</p>
              <img src="${qrUrl}" alt="QR Code" style="width: 180px; height: 180px; border-radius: 8px; display: block; margin: 0 auto;" />
              <p style="font-size: 12px; color: rgba(34,39,31,.6); margin: 12px 0 0;">Take a screenshot or scan it at the entrance to check in.</p>
            </div>

            <div style="background: #fff; border: 1px solid #ECE3D2; border-radius: 10px; padding: 16px; margin-bottom: 20px;">
              <p style="font-size: 11px; margin: 0; line-height: 1.6; color: #B33A3A;">
                <strong>How to check in:</strong> At the door, either tap your NFC card, enter your 4-digit code, or scan your QR.
              </p>
            </div>

            <p style="font-size: 11px; text-align: center; color: rgba(34,39,31,.5); margin: 20px 0 0; letter-spacing: .34em; text-transform: uppercase;">
              #TeamOdetayo &middot; Est 2026
            </p>
          </div>
        </div>
      `
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] Failed to send email:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendWelcomeEmail };