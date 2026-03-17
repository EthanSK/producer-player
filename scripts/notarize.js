// @ts-check
const { notarize } = require('@electron/notarize');
const path = require('path');

/**
 * afterSign hook for electron-builder.
 * Notarizes the macOS app bundle so Gatekeeper allows it to run.
 *
 * Required environment variables (all must be set for notarization to run):
 *   APPLE_ID                     – Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD  – app-specific password (appleid.apple.com → Security)
 *   APPLE_TEAM_ID                – 10-char Apple Developer Team ID
 *
 * If any of these are missing, notarization is skipped silently so local
 * unsigned dev builds still work.
 */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS builds (not MAS — Apple handles that)
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      '[notarize] Skipping notarization — APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID not set.'
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] Notarizing ${appPath} …`);

  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log('[notarize] Done.');
};
