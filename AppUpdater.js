class AppUpdater {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    this.currentVersion = null;
  }

  _getPlugins() {
    return {
      Filesystem: window.Capacitor?.Plugins?.Filesystem,
      FileOpener: window.Capacitor?.Plugins?.FileOpener || window.FileOpener
    };
  }

  _log(msg, level = "info") {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [AppUpdater] [${level.toUpperCase()}] ${msg}`);
  }

  async init() {
    this._log("Инициализация автообновления...");
    await this.loadAppVersion();
    if (this.currentVersion) {
      setTimeout(() => this.checkForUpdates(), 2000);
    }
  }

  async loadAppVersion() {
    try {
      const res = await fetch('./package.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pkg = await res.json();
      this.currentVersion = pkg.version;
      this.applyVersionUI(this.currentVersion);
      this._log(`Текущая версия: v${this.currentVersion}`);
    } catch (e) {
      this._log(`Ошибка чтения версии: ${e.message}`, "error");
    }
  }

  applyVersionUI(version) {
    const verStr = `v${version}`;
    const headerEl = document.getElementById('appVersionHeader');
    const menuEl = document.getElementById('appVersion');
    if (headerEl) headerEl.innerText = verStr;
    if (menuEl) menuEl.innerText = verStr;
  }

  // Проверка релиза через GitHub API
  async checkForUpdates() {
    try {
      const apiUrl = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
      this._log(`Запрос последнего релиза с GitHub API: ${apiUrl}`);

      const res = await fetch(apiUrl, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!res.ok) return;

      const release = await res.json();
      // Получаем версию из тега (например "v1.0.59" -> "1.0.59")
      const remoteVer = release.tag_name ? release.tag_name.replace(/^v/, '') : null;

      // Находим ассет с расширением .apk
      const apkAsset = release.assets?.find(a => a.name === 'app-debug.apk') ||
                       release.assets?.find(a => a.name.endsWith('.apk'));

      if (remoteVer && apkAsset && this.isNewerVersion(remoteVer, this.currentVersion)) {
        this._log(`Найден новый релиз v${remoteVer}. URL: ${apkAsset.browser_download_url}`);
        this.latestApkUrl = apkAsset.browser_download_url;
        this.showUpdateUI(remoteVer);
      }
    } catch (err) {
      this._log(`Ошибка проверки релизов: ${err.message}`, "warn");
    }
  }

  isNewerVersion(remote, local) {
    const r = remote.split('.').map(Number);
    const l = local.split('.').map(Number);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      if ((r[i] || 0) > (l[i] || 0)) return true;
      if ((r[i] || 0) < (l[i] || 0)) return false;
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
    const { Filesystem, FileOpener } = this._getPlugins();
    const btnUpdateApp = document.getElementById('btnUpdateApp');

    if (btnUpdateApp) {
      btnUpdateApp.innerText = "Загрузка обновления...";
      btnUpdateApp.disabled = true;
    }

    try {
      const downloadUrl = this.latestApkUrl || 
        `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/app-debug.apk`;

      this._log(`Скачивание APK: ${downloadUrl}`);

      if (window.Capacitor?.isNativePlatform() && Filesystem) {
        // Скачиваем нативно через Java
        const downloadResult = await Filesystem.downloadFile({
          url: downloadUrl,
          path: 'app-debug.apk',
          directory: 'CACHE',
          recursive: true
        });

        this._log(`Файл скачан: ${downloadResult.path}`);

        if (btnUpdateApp) btnUpdateApp.innerText = "Установка...";

        if (!FileOpener) throw new Error("Плагин FileOpener не установлен");

        await FileOpener.open({
          filePath: downloadResult.path,
          contentType: 'application/vnd.android.package-archive'
        });
      } else {
        window.location.href = downloadUrl;
      }
    } catch (e) {
      this._log(`Ошибка установки: ${e.message}`, "error");
      alert("Не удалось обновить приложение: " + e.message);

      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Обновить приложение";
        btnUpdateApp.disabled = false;
      }
    }
  }
}
