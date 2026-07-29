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

async function sendWelcomeEmail(guest, rawToken) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[mailer] SMTP not configured — skipping email to ${guest.email}`);
    return { sent: false, reason: 'SMTP not configured' };
  }

  const fromAddress = process.env.FROM_EMAIL || process.env.SMTP_USER;
  
  // Display token in email (this is the raw token the user needs to present)
  const displayToken = rawToken || 'N/A';

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: guest.email,
      subject: 'Registration Confirmed — Timeless Sunday',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; background: #121212; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 32px 24px; text-align: center;">
            <h1 style="color: #00d4aa; font-size: 28px; margin: 0 0 8px; font-family: Georgia, serif; font-style: italic;">Timeless</h1>
            <p style="color: #fff; font-size: 18px; margin: 0; font-family: Georgia, serif;">Sunday</p>
          </div>
          <div style="padding: 24px; background: #1a1a1a;">
            <h2 style="color: #fff; font-size: 20px; margin: 0 0 16px;">Registration Confirmed!</h2>
            <p style="color: #aaa; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
              Hi <strong style="color: #fff;">${guest.name}</strong>, your registration for <strong style="color: #00d4aa;">Timeless Sunday</strong> is confirmed.
            </p>
            
            <div style="background: #2a2a2a; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
              <p style="color: #888; font-size: 12px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Your Token</p>
              <p style="color: #00d4aa; font-size: 16px; font-family: monospace; margin: 0; font-weight: 600;">${displayToken}</p>
              <p style="color: #888; font-size: 11px; margin: 8px 0 0;">Present this token at the event entrance for check-in</p>
            </div>
            
            <div style="background: #2a2a2a; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
              <p style="color: #888; font-size: 12px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Event Details</p>
              <p style="color: #fff; font-size: 14px; margin: 0 0 4px;">📅 26th April 2026</p>
              <p style="color: #fff; font-size: 14px; margin: 0 0 4px;">📍 Epe & Lekki Phase 1</p>
              <p style="color: #fff; font-size: 14px; margin: 0;">🕐 2:00 PM</p>
            </div>
            
            <div style="background: #1a2a1a; border: 1px solid rgba(0, 212, 170, 0.3); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
              <p style="color: #00d4aa; font-size: 14px; margin: 0; line-height: 1.5;">
                <strong>Important:</strong> Bring your NFC card to the event. Tap it at the entrance for check-in.
              </p>
            </div>
            
            ${guest.plus_one ? `
            <div style="background: #2a2a2a; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
              <p style="color: #888; font-size: 12px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Plus-One</p>
              <p style="color: #fff; font-size: 14px; margin: 0;">${guest.plus_one_name || 'Guest'}</p>
            </div>
            ` : ''}
            
            <p style="color: #666; font-size: 12px; text-align: center; margin: 20px 0 0;">
              Team Odetayo — Est 2026
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