const { Expo } = require("expo-server-sdk");
const expo = new Expo();

/**
 * Send a push notification to one user, if they have push enabled and a
 * registered Expo push token. Silently no-ops otherwise (e.g. user hasn't
 * granted notification permission, or is on web/dev without a real device).
 */
async function notifyUser(user, title, body, data = {}) {
  if (!user || !user.pushEnabled || !user.expoPushToken) return;
  if (!Expo.isExpoPushToken(user.expoPushToken)) return;

  const message = {
    to: user.expoPushToken,
    sound: user.notifSounds ? "default" : null,
    title,
    body,
    data,
  };

  try {
    await expo.sendPushNotificationsAsync([message]);
  } catch (e) {
    console.error("Push notification failed:", e.message);
  }
}

module.exports = { notifyUser };
