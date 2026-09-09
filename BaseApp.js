class BaseApp {
  constructor(config = {}) {
    // Безопасное извлечение параметров из объекта или аргументов
    const repoOwner = typeof config === 'string' ? config : config?.repoOwner;
    const repoName = config?.repoName;

    // Инициализация сервисов
    this.updater = new AppUpdater(repoOwner, repoName);
    this.ble = new BaseBLEDevice(config);

    // Связываем передачу телеметрии в MainApp
    if (this.ble) {
      this.ble.onTelemetry = (data) => this.onTelemetry(data);
    }

    // Глобальный перехватчик JS-ошибок
    window.onerror = (msg, url, line, col, error) => {
      alert(`🚨 Ошибка JS:\n${msg}\nСтрока: ${line}:${col}`);
      return true;
    };

    window.addEventListener('unhandledrejection', (event) => {
      alert(`🚨 Необработанный Promise:\n${event.reason}`);
    });
  }

  async init() {
    console.log("[JE Core] Инициализация BaseApp...");

    // 1. Модуль автообновлений (в изоляции)
    try {
      if (this.updater) {
        if (typeof this.updater.init === 'function') {
          await this.updater.init();
        } else if (typeof this.updater.checkForUpdates === 'function') {
          await this.updater.checkForUpdates();
        }
      }
    } catch (err) {
      console.error("[AppUpdater] Сбой автопроверки обновлений:", err);
    }

    // 2. Модуль BLE (в изоляции)
    try {
      if (this.ble && typeof this.ble.init === 'function') {
        await this.ble.init();
      }
    } catch (err) {
      console.error("[JE Core] Сбой инициализации BLE:", err);
    }
  }

  onTelemetry(data) {} // Переопределяется в app.js

  async connectOrReconnect() {
    try {
      await this.ble.connectOrReconnect();
    } catch (err) {
      alert(`🚨 Ошибка при подключении:\n${err.message || err}`);
    }
  }

  async selectNewDevice() {
    try {
      await this.ble.selectNewDevice();
    } catch (err) {
      alert(`🚨 Ошибка выбора устройства:\n${err.message || err}`);
    }
  }

  checkForUpdates() { this.updater.checkForUpdates(); }
  updateApp() { this.updater.updateApp(); }
  disconnectBLE() { this.ble.disconnectBLE(); }
  updateESP32Firmware() { this.ble.updateESP32Firmware(); }
}
