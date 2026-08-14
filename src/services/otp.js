const crypto = require("crypto");

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  // Only require + initialize Twilio if credentials are actually present —
  // keeps local development working with zero external accounts.
  const twilio = require("twilio");
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

function generateCode() {
  // 6-digit numeric OTP. Using crypto for a non-guessable code (Math.random is not secure enough for this).
  return String(crypto.randomInt(100000, 999999));
}

async function sendOtp(phone, code) {
  if (twilioClient && process.env.TWILIO_FROM_NUMBER) {
    await twilioClient.messages.create({
      body: `Your moveMe verification code is ${code}. It expires in 10 minutes.`,
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone,
    });
    return { sent: true, via: "sms" };
  }
  // Development fallback — no Twilio configured yet. Log it so the tester can
  // read it in the terminal instead of receiving a real text.
  console.log(`\n[DEV OTP] ${phone} -> ${code}\n`);
  return { sent: true, via: "console-dev-fallback" };
}

module.exports = { generateCode, sendOtp };
