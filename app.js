class MainApp extends BaseApp {
  constructor() {
    super({
      repoOwner: "johneagle200-ship-it",
      repoName: "je-ble-template"
    });
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

    // 3. Обновление версии прошивки ESP32
    const fwVersion = data.fw || data.sys?.fw || data.version;
    if (fwVersion) {
      const fwEl = document.getElementById('espFwText');
      if (fwEl) fwEl.innerText = fwVersion;
    }
  }
}

const app = new MainApp();
document.addEventListener("DOMContentLoaded", () => app.init());
