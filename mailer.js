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

async function sendWelcomeEmail(guest) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[mailer] SMTP not configured — skipping email to ${guest.email}`);
    return { sent: false, reason: 'SMTP not configured' };
  }

  const fromAddress = process.env.FROM_EMAIL || process.env.SMTP_USER;

  try {
    await transporter.sendMail({
      from: fromAddress,
      to: guest.email,
      subject: 'Welcome to Team Odetayo — Est 2026',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: linear-gradient(90deg, #1D9E75, #8A6F45); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: #fff; font-size: 18px; margin: 0;">Welcome, ${guest.name}!</h1>
          </div>
          <div style="padding: 20px; border: 1px solid #eee; border-top: none; border-radius: 0 0 12px 12px;">
            <p>You're registered for <strong>Team Odetayo — Est 2026</strong>.</p>
            <p>Your NFC card is your entry pass. Please bring it with you to the event — you'll tap it at the entrance for check-in.</p>
            <p style="font-size: 13px; color: #888;">Card ID: ${guest.tag_uid}</p>
            ${guest.plus_one ? `<p>Plus-one registered: <strong>${guest.plus_one_name || 'Guest'}</strong></p>` : ''}
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
