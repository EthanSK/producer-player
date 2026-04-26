/**
 * Platform gate for the auto-updater's installer-signature verification step.
 *
 * On macOS the .app is signed with a Developer ID + notarized; the OS
 * validates that on launch and electron-updater's mac code path validates
 * the downloaded payload against the same identity. That gate must run.
 *
 * On Windows we currently ship an unsigned NSIS installer — but the macOS
 * notarization secrets (`CSC_LINK`) are also set on the Windows runner, so
 * electron-builder lazily extracts the Apple Developer ID common name and
 * writes it into `app-update.yml` as `publisherName`. At update time
 * `Get-AuthenticodeSignature` then rejects every download with the macOS
 * cert dump in the payload. Until we ship a real Windows code-signing cert,
 * skip publisher verification on Windows + Linux. macOS keeps its check.
 *
 * This helper lives in its own module so it can be unit-tested without
 * loading Electron (`apps/electron/test/auto-update-signature.test.cjs`).
 */
export function shouldVerifyInstallerSignature(platform: NodeJS.Platform): boolean {
  return platform === 'darwin';
}
