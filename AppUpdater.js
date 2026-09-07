class AppUpdater {
  constructor({ repoOwner, repoName }) {
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.currentVersion = null;
  }

  async init() {
    await this.loadAppVersion();
  }

  async loadAppVersion() {
    try {
      const res = await fetch('./package.json');
      const pkg = await res.json();
      this.currentVersion = pkg.version;
      const verStr = `v${pkg.version}`;

      const headerEl = document.getElementById('appVersionHeader');
      const menuEl = document.getElementById('appVersion');

      if (headerEl) headerEl.innerText = verStr;
      if (menuEl) menuEl.innerText = verStr;
    } catch (err) {
      console.error('AppUpdater: Ошибка чтения package.json', err);
    }
  }

  async checkForUpdates() {
    if (!this.repoOwner || !this.repoName) return;

    try {
      const url = `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/main/package.json?t=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Сбой сети при запросе к GitHub');

      const remotePkg = await res.json();
      const remoteVer = remotePkg.version;

      if (this.isNewerVersion(remoteVer, this.currentVersion)) {
        this.showUpdateUI(remoteVer);
      } else {
        alert('У вас установлена последняя версия.');
      }
    } catch (err) {
      console.error('AppUpdater: Ошибка проверки обновлений', err);
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

    if (badge) badge.style.display = 'block';
    if (notice) notice.style.display = 'block';
    if (btnUpdateApp) btnUpdateApp.style.display = 'block';
  }

  updateApp() {
    window.location.reload(true);
  }
}
