class AppUpdater {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    this.currentVersion = null;
    this.Filesystem = window.Capacitor?.Plugins?.Filesystem;
    this.CapacitorHttp = window.Capacitor?.Plugins?.CapacitorHttp;
    this.FileOpener = window.Capacitor?.Plugins?.FileOpener;
  }

  async init() {
    await this.loadAppVersion();
    if (this.currentVersion) {
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
    
    if (!this.Filesystem || !this.CapacitorHttp) {
      console.warn("[AppUpdater] Нативные плагины Filesystem или CapacitorHttp недоступны. Откат на браузер.");
      window.open(apkUrl, '_system');
      return;
    }

    try {
      const btnUpdateApp = document.getElementById('btnUpdateApp');
      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Загрузка обновления...";
        btnUpdateApp.disabled = true;
      }

      console.log("[AppUpdater] Скачивание APK через CapacitorHttp...");
      
      // Скачиваем файл в формате base64, чтобы обойти проблемы с бинарными стримами в WebView
      const response = await this.CapacitorHttp.get({
        url: apkUrl,
        responseType: 'base64'
      });

      if (!response || !response.data) {
        throw new Error("Не удалось получить данные APK с сервера");
      }

      console.log("[AppUpdater] Сохранение APK во внешнее хранилище кэша...");
      const fileName = `update_${Date.now()}.apk`;

      // Сохраняем в системную директорию кэша (DIRECTORY_CACHE или EXTERNAL_CACHE)
      const savedFile = await this.Filesystem.writeFile({
        path: fileName,
        data: response.data,
        directory: 'CACHE'
      });

      console.log("[AppUpdater] Файл сохранен:", savedFile.uri);

      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Установка...";
      }

      // Открываем скачанный файл для установки силами Android
      if (this.FileOpener && typeof this.FileOpener.open === 'function') {
        await this.FileOpener.open({
          filePath: savedFile.uri,
          contentType: 'application/vnd.android.package-archive'
        });
      } else {
        // Запасной вариант через системный Intent браузера/файлового менеджера для локального файла
        const Browser = window.Capacitor?.Plugins?.Browser;
        if (Browser && typeof Browser.open === 'function') {
          await Browser.open({ url: savedFile.uri });
        } else {
          window.open(savedFile.uri, '_system');
        }
      }

    } catch (e) {
      console.error("[AppUpdater] Ошибка при внутриаппаратном обновлении:", e);
      alert("Не удалось обновить приложение автоматически: " + (e?.message || e));
      
      const btnUpdateApp = document.getElementById('btnUpdateApp');
      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Обновить приложение";
        btnUpdateApp.disabled = false;
      }
    }
  }
}
