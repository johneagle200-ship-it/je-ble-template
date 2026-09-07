class AppUpdater {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    this.currentVersion = null;
  }

  async init() {
    await this.loadAppVersion();
    if (this.currentVersion) {
      this.checkForUpdates();
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
    // 1. Пробуем прочитать локальный package.json (если упакован в webDir)
    try {
      const res = await fetch('./package.json');
      if (res.ok) {
        const pkg = await res.json();
        if (pkg.version) {
          this.currentVersion = pkg.version;
          this.applyVersionUI(this.currentVersion);
          return;
        }
      }
    } catch (e) {
      console.warn('[AppUpdater] Локальный package.json недоступен в APK.');
    }

    // 2. Резервный вариант: подтягиваем версию из main-ветки GitHub
    try {
      const url = `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/main/package.json?t=${Date.now()}`;
      const res = await fetch(url);
      if (res.ok) {
        const pkg = await res.json();
        if (pkg.version) {
          this.currentVersion = pkg.version;
          this.applyVersionUI(this.currentVersion);
        }
      }
    } catch (e) {
      console.error('[AppUpdater] Не удалось получить версию:', e);
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
      console.error('[AppUpdater] Ошибка проверки обновлений:', err);
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
    if (btnUpdateApp) btnUpdateApp.style.display = 'block';
  }

  updateApp() {
    const apkUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/app-debug.apk`;
    window.open(apkUrl, '_system');
  }
}
