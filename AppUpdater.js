class AppUpdater {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    this.currentVersion = null;
    this.currentEspFwVersion = null;
    this.latestFirmwareInfo = null;
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
      this._log(`Текущая версия приложения: v${this.currentVersion}`);
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

  // --- ПРОВЕРКА ОБНОВЛЕНИЯ APK ПРИЛОЖЕНИЯ ---
  async checkForUpdates() {
    try {
      const apiUrl = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
      this._log(`Запрос последнего релиза с GitHub API: ${apiUrl}`);

      const res = await fetch(apiUrl, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!res.ok) return;

      const release = await res.json();
      const remoteVer = release.tag_name ? release.tag_name.replace(/^v/, '') : null;

      const apkAsset = release.assets?.find(a => a.name === 'app-debug.apk') ||
                       release.assets?.find(a => a.name.endsWith('.apk'));

      if (remoteVer && apkAsset && this.isNewerVersion(remoteVer, this.currentVersion)) {
        this._log(`Найден новый релиз приложения v${remoteVer}. URL: ${apkAsset.browser_download_url}`);
        this.latestApkUrl = apkAsset.browser_download_url;
        this.showUpdateUI(remoteVer);
      }
    } catch (err) {
      this._log(`Ошибка проверки релизов: ${err.message}`, "warn");
    }
  }

  // --- ПРОВЕРКА ОБНОВЛЕНИЯ ПРОШИВКИ ESP32 ---
  async checkFirmwareUpdate(espFwVersion) {
    if (!espFwVersion) return;
    this.currentEspFwVersion = espFwVersion;

    try {
      const rawPkgUrl = `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/main/package.json`;
      this._log(`Проверка прошивки ESP32 по URL: ${rawPkgUrl}`);

      const res = await fetch(rawPkgUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const pkg = await res.json();
      if (!pkg.firmware || !pkg.firmware.version) return;

      const remoteFwVer = pkg.firmware.version;

      if (this.isNewerVersion(remoteFwVer, this.currentEspFwVersion)) {
        const binFileName = pkg.firmware.file || "firmware.bin";
        
        this.latestFirmwareInfo = {
          version: remoteFwVer,
          changelog: pkg.firmware.changelog || "",
          downloadUrl: `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/main/${binFileName}`
        };

        this._log(`Доступна новая прошивка ESP32 v${remoteFwVer} (${binFileName})`);
        this.showFirmwareUpdateUI(this.latestFirmwareInfo);
      }
    } catch (err) {
      this._log(`Ошибка проверки прошивки: ${err.message}`, "warn");
    }
  }

  // --- СКАЧИВАНИЕ БИНАРНИКА DЛЯ BLE OTA ---
  async fetchFirmwareBinary() {
    if (!this.latestFirmwareInfo?.downloadUrl) {
      throw new Error("Ссылка на бинарник прошивки не найдена");
    }

    this._log(`Скачивание бинарника прошивки: ${this.latestFirmwareInfo.downloadUrl}`);
    const res = await fetch(this.latestFirmwareInfo.downloadUrl);
    if (!res.ok) throw new Error(`Ошибка скачивания файла: HTTP ${res.status}`);

    return await res.arrayBuffer(); // Возвращает бинарник для передачи в BLE OTA
  }

  isNewerVersion(remote, local) {
    if (!local) return true;
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

  showFirmwareUpdateUI(fwInfo) {
    const badge = document.getElementById('menuBadge');
    const fwNotice = document.getElementById('fwUpdateNotice');
    const btnUpdateFw = document.getElementById('btnUpdateFirmware');
    const fwTextEl = document.getElementById('fwUpdateNoticeText');

    if (badge) badge.style.display = 'block';
    if (fwNotice) fwNotice.style.display = 'block';
    if (fwTextEl) {
      fwTextEl.innerText = `Доступна прошивка ESP32 v${fwInfo.version}: ${fwInfo.changelog}`;
    }
    if (btnUpdateFw) {
      btnUpdateFw.style.display = 'block';
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
      if (!this.latestApkUrl) throw new Error("URL для скачивания не найден");
      const downloadUrl = this.latestApkUrl;

      this._log(`Скачивание APK: ${downloadUrl}`);

      if (window.Capacitor?.isNativePlatform() && Filesystem) {
        const downloadResult = await Filesystem.downloadFile({
          url: downloadUrl,
          path: 'app-debug.apk',
          directory: 'DATA',
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
