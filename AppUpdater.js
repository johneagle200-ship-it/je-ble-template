class AppUpdater {
  constructor(ownerOrConfig = {}, repoName) {
    if (typeof ownerOrConfig === 'object' && ownerOrConfig !== null) {
      this.repoOwner = ownerOrConfig.repoOwner || "johneagle200-ship-it";
      this.repoName = ownerOrConfig.repoName || "je-ble-template";
    } else {
      this.repoOwner = ownerOrConfig || "johneagle200-ship-it";
      this.repoName = repoName || "je-ble-template";
    }

    this.currentVersion = null;
    this._initPlugins();
  }

  _initPlugins() {
    this.Filesystem = window.Capacitor?.Plugins?.Filesystem;
    this.CapacitorHttp = window.Capacitor?.Plugins?.CapacitorHttp;
    this.FileOpener = window.Capacitor?.Plugins?.FileOpener || window.FileOpener;
  }

  _log(msg, level = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] [AppUpdater] [${level.toUpperCase()}] ${msg}`;
    console.log(formatted);
  }

  async init() {
    this._log("Инициализация модуля обновления...");
    this._initPlugins();
    await this.loadAppVersion();
    if (this.currentVersion) {
      setTimeout(() => this.checkForUpdates(), 2000);
    } else {
      this._log("Не удалось определить текущую версию, проверка обновлений пропущена.", "warn");
    }
  }

  applyVersionUI(version) {
    const verStr = `v${version}`;
    const headerEl = document.getElementById('appVersionHeader');
    const menuEl = document.getElementById('appVersion');

    if (headerEl) headerEl.innerText = verStr;
    if (menuEl) menuEl.innerText = verStr;
    this._log(`Интерфейс обновлен до версии ${verStr}`);
  }

  async loadAppVersion() {
    try {
      this._log("Чтение локального package.json...");
      const res = await fetch('./package.json');
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const pkg = await res.json();
      if (pkg.version) {
        this.currentVersion = pkg.version;
        this._log(`Локальная версия определена: ${this.currentVersion}`);
        this.applyVersionUI(this.currentVersion);
      } else {
        this._log("В локальном package.json отсутствует поле version", "warn");
      }
    } catch (e) {
      this._log(`Ошибка чтения локального package.json: ${e?.message || e}`, "error");
    }
  }

  async checkForUpdates() {
    if (!this.repoOwner || !this.repoName || !this.currentVersion) {
      this._log("Пропуск проверки: не задан репозиторий или текущая версия", "warn");
      return;
    }

    try {
      const url = `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/main/package.json?t=${Date.now()}`;
      this._log(`Запрос удаленной версии с GitHub: ${url}`);
      
      const res = await fetch(url);
      if (!res.ok) {
        this._log(`Не удалось получить удаленный package.json, статус: ${res.status}`, "warn");
        return;
      }

      const remotePkg = await res.json();
      const remoteVer = remotePkg.version;
      this._log(`Удаленная версия на ветке main: ${remoteVer} (текущая: ${this.currentVersion})`);

      if (remoteVer && this.isNewerVersion(remoteVer, this.currentVersion)) {
        this._log(`Доступна новая версия ${remoteVer}! Активация UI обновления.`);
        this.showUpdateUI(remoteVer);
      } else {
        this._log("Установлена актуальная версия приложения.");
      }
    } catch (err) {
      this._log(`Ошибка/таймаут проверки обновлений: ${err?.message || err}`, "error");
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
    this._initPlugins();
    const apkUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/app-debug.apk`;
    this._log(`Старт процесса обновления. Целевой URL APK: ${apkUrl}`);

    const btnUpdateApp = document.getElementById('btnUpdateApp');
    if (btnUpdateApp) {
      btnUpdateApp.innerText = "Загрузка обновления...";
      btnUpdateApp.disabled = true;
    }

    try {
      const isNative = window.Capacitor && window.Capacitor.isNativePlatform();
      let targetPath = '';

      if (isNative && this.Filesystem) {
        this._log("Загрузка app-debug.apk через нативный модуль Filesystem...");

        if (typeof this.Filesystem.downloadFile === 'function') {
          // Нативное скачивание через Java в обход ограничений WebView/CORS
          const downloadResult = await this.Filesystem.downloadFile({
            url: apkUrl,
            path: 'app-debug.apk',
            directory: 'CACHE',
            recursive: true
          });
          targetPath = downloadResult.path || downloadResult.uri;
        } else {
          // Запасной фолбэк с использованием CapacitorHttp или fetch
          this._log("downloadFile недоступен, использование резервного потока...", "warn");
          let blob;
          if (this.CapacitorHttp) {
            const res = await this.CapacitorHttp.get({ url: apkUrl, responseType: 'blob' });
            blob = res.data;
          } else {
            const response = await fetch(apkUrl);
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
            blob = await response.blob();
          }

          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result;
              const base64 = typeof result === 'string' ? result.split(',')[1] : '';
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const savedFile = await this.Filesystem.writeFile({
            path: 'app-debug.apk',
            data: base64Data,
            directory: 'CACHE'
          });
          targetPath = savedFile.uri;
        }
      } else {
        window.location.href = apkUrl;
        return;
      }

      this._log(`Файл сохранен по пути: ${targetPath}`);

      if (btnUpdateApp) btnUpdateApp.innerText = "Установка...";

      if (!this.FileOpener || typeof this.FileOpener.open !== 'function') {
        throw new Error("Плагин FileOpener недоступен.");
      }

      await this.FileOpener.open({
        filePath: targetPath,
        contentType: 'application/vnd.android.package-archive',
        openWithDefault: true
      });

    } catch (e) {
      this._log(`ОШИБКА обновления: ${e?.message || e}`, "error");
      alert("Не удалось обновить приложение: " + (e?.message || e));

      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Обновить приложение";
        btnUpdateApp.disabled = false;
      }
    }
  }
}
