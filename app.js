class MainApp extends BaseApp {
  constructor() {
    super({
      repoOwner: "johneagle200-ship-it",
      repoName: "je-ble-template"
    });

    // Явно связываем BLE-декодер с методом обработки телеметрии MainApp
    if (this.ble) {
      this.ble.onTelemetryCallback = (data) => this.onTelemetry(data);
    }
  }

  onTelemetry(data) {
    console.log("[APP TELEMETRY]", data); // Лог для Eruda

    // 1. Обновление счетчика
    const currentCounter = data.counter !== undefined ? data.counter : (data.cnt !== undefined ? data.cnt : null);
    if (currentCounter !== null) {
      const el = document.getElementById('telemetryData');
      if (el) el.innerText = currentCounter;
    } else if (data.val !== undefined) {
      const el = document.getElementById('telemetryData');
      if (el) el.innerText = data.val;
    }

    // 2. Обновление аптайма
    const currentUptime = data.uptime !== undefined ? data.uptime : (data.up !== undefined ? data.up : null);
    if (currentUptime !== null) {
      const uptimeEl = document.getElementById('uptimeData');
      if (uptimeEl) uptimeEl.innerText = `${currentUptime} с`;
    }

    // 3. Обновление версии прошивки ESP32
    const fwVersion = data.fw || (data.sys && data.sys.fw) || data.version;
    if (fwVersion) {
      const fwEl = document.getElementById('espFwText');
      if (fwEl) fwEl.innerText = fwVersion;
    }
  }
}

const app = new MainApp();
document.addEventListener("DOMContentLoaded", () => app.init());
