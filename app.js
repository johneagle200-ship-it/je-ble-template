class MainApp extends BaseBLEDevice {
  constructor() {
    super({
      repoOwner: "johneagle200-ship-it",
      repoName: "je-ble-template"
    });
  }

  onTelemetry(data) {
    // 1. Выводим счётчик пакетов от ESP32 в центральный блок
    if (data.counter !== undefined) {
      const el = document.getElementById('telemetryData');
      if (el) el.innerText = `# ${data.counter}`;
    } else if (data.val !== undefined) {
      const el = document.getElementById('telemetryData');
      if (el) el.innerText = data.val;
    }

    // 2. Если понадобится вывести время работы ESP32 (в секундах)
    if (data.uptime !== undefined) {
      const uptimeEl = document.getElementById('uptimeData');
      if (uptimeEl) uptimeEl.innerText = `${data.uptime} с`;
    }
  }
}

const app = new MainApp();
document.addEventListener("DOMContentLoaded", () => app.init());
