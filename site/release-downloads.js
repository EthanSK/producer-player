// Extracted from index.html's syncSiteVersionLabel. GitHub's published release,
// rather than the newer source checkout, owns the displayed downloadable version.
(async function syncPublishedRelease() {
  try {
    var response = await fetch('https://api.github.com/repos/EthanSK/producer-player/releases/latest', { cache: 'no-store' });
    if (!response.ok) return;
    var release = await response.json();
    var match = /^v(\d+\.\d+)(?:\.0)?(?:-build\.\d+)?$/.exec(release.tag_name || '');
    if (!match || release.draft || release.prerelease || !Array.isArray(release.assets)) return;
    var version = match[1] + '.0';
    var targets = [
      { id: 'hero-download-primary', suffix: 'mac-universal.zip' },
      { id: 'hero-download-win', suffix: 'win-x64.exe' },
      { id: 'hero-download-linux', suffix: 'linux-x64.AppImage' },
    ].map(function (target) {
      var filename = 'Producer-Player-' + version + '-' + target.suffix;
      var expected = 'https://github.com/EthanSK/producer-player/releases/download/' +
        encodeURIComponent(release.tag_name) + '/' + encodeURIComponent(filename);
      var asset = release.assets.find(function (candidate) {
        return candidate.name === filename && candidate.browser_download_url === expected;
      });
      return { id: target.id, url: asset && asset.browser_download_url };
    });
    // Keep the stable aliases and placeholder if any platform is absent.
    if (targets.some(function (target) { return !target.url; })) return;
    var label = document.getElementById('site-version-label');
    if (label) label.textContent = release.tag_name;
    targets.forEach(function (target) {
      var element = document.getElementById(target.id);
      if (element) element.setAttribute('href', target.url);
    });
  } catch (_) {
    // Network/rate-limit failures retain the existing stable download aliases.
  }
})();
