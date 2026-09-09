class AppUpdater {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    this.currentVersion = null;
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
    const apkUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/app-debug.apk`;
    this._log(`Старт процесса обновления. Целевой URL APK: ${apkUrl}`);
    
    if (!this.Filesystem) {
      this._log("Нативный плагин Filesystem недоступен.", "error");
      alert("Ошибка: плагин Filesystem не инициализирован.");
      return;
    }
  
    try {
      const btnUpdateApp = document.getElementById('btnUpdateApp');
      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Загрузка обновления...";
        btnUpdateApp.disabled = true;
      }
  
      this._log("Загрузка APK через fetch и конвертация в Base64...");
      const response = await fetch(apkUrl);
      if (!response.ok) throw new Error(`Ошибка скачивания: HTTP ${response.status}`);
  
      const blob = await response.blob();
      
      // Надежное преобразование Blob в чистый Base64
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          const base64 = result.split(',')[1]; // Отрезаем префикс data:...;base64,
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
  
      this._log(`APK успешно конвертирован в Base64. Длина строки: ${base64Data.length}`);
  
      const fileName = "app-debug.apk";
      const savedFile = await this.Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: 'CACHE'
      });
  
      this._log(`Файл сохранен: ${savedFile.uri}`);
  
      if (btnUpdateApp) btnUpdateApp.innerText = "Установка...";
  
      if (!this.FileOpener || typeof this.FileOpener.open !== 'function') {
        throw new Error("Плагин FileOpener недоступен.");
      }
  
      await this.FileOpener.open({
        filePath: savedFile.uri,
        contentType: 'application/vnd.android.package-archive',
        openWithDefault: true
      });
  
    } catch (e) {
      this._log(`ОШИБКА обновления: ${e?.message || e}`, "error");
      alert("Не удалось обновить приложение: " + (e?.message || e));
      
      const btnUpdateApp = document.getElementById('btnUpdateApp');
      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Обновить приложение";
        btnUpdateApp.disabled = false;
      }
    }
  }
}
