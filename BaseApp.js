class BaseApp {
  constructor(config) {
    this.updater = new AppUpdater(config);
    this.ble = new BaseBLEDevice(config);

    // Связываем передачу телеметрии в MainApp
    if (this.ble) {
      this.ble.onTelemetry = (data) => this.onTelemetry(data);
    }

    // Глобальный перехватчик JS-ошибок (выведет текст на экран вместо вылета)
    window.onerror = (msg, url, line, col, error) => {
      alert(`🚨 Ошибка JS:\n${msg}\nСтрока: ${line}:${col}`);
      return true; // Предотвращает падение приложения
    };

    window.addEventListener('unhandledrejection', (event) => {
      alert(`🚨 Необработанный Promise:\n${event.reason}`);
    });
  }

  async init() {
    await this.updater.init();
    if (this.ble && typeof this.ble.init === 'function') {
      await this.ble.init();
    }
  }

  onTelemetry(data) {} // Переопределяется в app.js

  // Безопасный вызов подключения с отловом исключений
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
