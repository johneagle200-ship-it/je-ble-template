class AppUpdater {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    this.currentVersion = null;
  }

  async init() {
    await this.loadAppVersion();
    if (this.currentVersion) {
      // Пауза 2с для полной инициализации сетевого стека Android
      setTimeout(() => this.checkForUpdates(), 2000);
    }
  }

  applyVersionUI(version) {
    const verStr = `v${version}`;
    const headerEl = document.getElementById('appVersionHeader');
    const menuEl = document.getElementById('appVersion');

    if (headerEl) headerEl.innerText = verStr;
    if (menuEl) menuEl.innerText = verStr;
  }

  async loadAppVersion() {
    try {
      const res = await fetch('./package.json');
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const pkg = await res.json();
      if (pkg.version) {
        this.currentVersion = pkg.version;
        this.applyVersionUI(this.currentVersion);
      }
    } catch (e) {
      console.warn('[AppUpdater] Ошибка чтения локального package.json:', e?.message || e);
    }
  }

  async checkForUpdates() {
    if (!this.repoOwner || !this.repoName || !this.currentVersion) return;

    try {
      const url = `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/main/package.json?t=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) return;

      const remotePkg = await res.json();
      const remoteVer = remotePkg.version;

      if (remoteVer && this.isNewerVersion(remoteVer, this.currentVersion)) {
        this.showUpdateUI(remoteVer);
      }
    } catch (err) {
      console.warn('[AppUpdater] Ошибка/таймаут проверки обновлений:', err?.message || err);
    }
  }

  isNewerVersion(remote, local) {
    if (!remote || !local) return false;
    const r = remote.split('.').map(Number);
    const l = local.split('.').map(Number);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const rv = r[i] || 0;
      const lv = l[i] || 0;
      if (rv > lv) return true;
      if (rv < lv) return false;
    }
    return false;
  }

  showUpdateUI(newVersion) {
    const badge = document.getElementById('menuBadge');
    const notice = document.getElementById('updateNotice');
    const btnUpdateApp = document.getElementById('btnUpdateApp');
    const textEl = document.getElementById('updateNoticeText');

    if (textEl) textEl.innerText = `Доступно обновление приложения v${newVersion}!`;
    if (badge) badge.style.display = 'block';
    if (notice) notice.style.display = 'block';
    if (btnUpdateApp) {
      btnUpdateApp.style.display = 'block';
      btnUpdateApp.onclick = () => this.updateApp();
    }
  }

  async updateApp() {
    const apkUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/app-debug.apk`;
    
    const capacitorBrowser = window.Capacitor?.Plugins?.Browser;
    if (capacitorBrowser && typeof capacitorBrowser.open === 'function') {
      try {
        await capacitorBrowser.open({ url: apkUrl });
        return;
      } catch (e) {
        console.warn('[AppUpdater] Ошибка Capacitor Browser, откат на window.open:', e);
      }
    }

    window.open(apkUrl, '_system');
  }
}
