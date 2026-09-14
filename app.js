class MainApp extends BaseApp {
  constructor() {
    super({
      repoOwner: "johneagle200-ship-it",
      repoName: "je-ble-template"
    });

    // Флаг, чтобы не опрашивать GitHub на каждый кадр телеметрии
    this.isFwChecked = false;
  }

  async init() {
    await super.init();

    // Подписываемся на прогресс OTA-прошивки (если BLE модуль поддерживает progress callback)
    if (this.ble) {
      this.ble.onOtaProgress = (percent) => {
        const fill = document.getElementById('otaProgressFill');
        const text = document.getElementById('otaProgressText');
        const container = document.getElementById('otaProgressContainer');

        if (container) container.style.display = 'block';
        if (fill) fill.style.width = `${percent}%`;
        if (text) text.innerText = `${percent}%`;
      };
    }
  }

  onTelemetry(data) {
    console.log("[APP TELEMETRY]", data);

    // 1. Обновление счётчика
    const counter = data.counter ?? data.cnt ?? data.val;
    if (counter !== undefined && counter !== null) {
      const el = document.getElementById('telemetryData');
      if (el) el.innerText = counter;
    }

    // 2. Обновление аптайма
    const uptime = data.uptime ?? data.up;
    if (uptime !== undefined && uptime !== null) {
      const uptimeEl = document.getElementById('uptimeData');
      if (uptimeEl) uptimeEl.innerText = `${uptime} с`;
    }

    // 3. Обновление версии прошивки ESP32 и запуск проверки обновлений
    const fwVersion = data.fw || data.sys?.fw || data.version;
    if (fwVersion) {
      const fwEl = document.getElementById('espFwText');
      if (fwEl) fwEl.innerText = fwVersion;

      // Вызываем проверку прошивки один раз за сессию подключения
      if (!this.isFwChecked && this.updater && typeof this.updater.checkFirmwareUpdate === 'function') {
        this.isFwChecked = true;
        this.updater.checkFirmwareUpdate(fwVersion);
      }
    }
  }
}

// Привязываем к window.app, чтобы AppUpdater мог достучаться до BLE-модуля
const app = new MainApp();
window.app = app;

document.addEventListener("DOMContentLoaded", () => app.init());
