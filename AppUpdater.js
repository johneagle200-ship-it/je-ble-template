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
    
    if (!this.Filesystem || !this.CapacitorHttp) {
      this._log("Нативные плагины Filesystem или CapacitorHttp недоступны в текущем окружении.", "error");
      alert("Ошибка: нативные плагины не инициализированы.");
      return;
    }

    try {
      const btnUpdateApp = document.getElementById('btnUpdateApp');
      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Загрузка обновления...";
        btnUpdateApp.disabled = true;
      }

      this._log("Отправка HTTP-запроса на скачивание APK (в формате base64)...");
      const response = await this.CapacitorHttp.get({
        url: apkUrl,
        responseType: 'base64'
      });

      if (!response || !response.data) {
        throw new Error("Не удалось получить данные APK с сервера (пустой ответ)");
      }
      
      this._log(`APK успешно скачан. Размер данных (base64): ~${Math.round(response.data.length / 1024)} КБ`);

      const fileName = `update_${Date.now()}.apk`;
      this._log(`Сохранение файла в системный внешний кэш под именем: ${fileName}`);

      const savedFile = await this.Filesystem.writeFile({
        path: fileName,
        data: response.data,
        directory: 'CACHE'
      });

      this._log(`Файл успешно сохранен на устройстве. URI: ${savedFile.uri}`);

      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Установка...";
      }

      this._log("Проверка доступности плагина FileOpener перед вызовом...");
      this._log(`Объект FileOpener: ${JSON.stringify(this.FileOpener)}`);

      if (!this.FileOpener || typeof this.FileOpener.open !== 'function') {
        throw new Error("Плагин FileOpener не установлен или недоступен в Capacitor.");
      }

      this._log(`Вызов FileOpener.open с filePath: ${savedFile.uri}`);
      
      const openResult = await this.FileOpener.open({
        filePath: savedFile.uri,
        contentType: 'application/vnd.android.package-archive',
        openWithDefault: true
      });
      
      this._log(`FileOpener.open успешно выполнился. Результат: ${JSON.stringify(openResult)}`);

    } catch (e) {
      this._log(`КРИТИЧЕСКАЯ ОШИБКА при внутриаппаратном обновлении: ${e?.message || e}`, "error");
      console.error(e);
      alert("Не удалось обновить приложение автоматически: " + (e?.message || e));
      
      const btnUpdateApp = document.getElementById('btnUpdateApp');
      if (btnUpdateApp) {
        btnUpdateApp.innerText = "Обновить приложение";
        btnUpdateApp.disabled = false;
      }
    }
  }
}
