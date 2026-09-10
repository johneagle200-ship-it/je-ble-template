class MainApp extends BaseApp {
  constructor() {
    super({
      repoOwner: "johneagle200-ship-it",
      repoName: "je-ble-template"
    });
  }

  onTelemetry(data) {
    // Единая проверка ключей счетчика
    const currentCounter = data.counter !== undefined ? data.counter : (data.cnt !== undefined ? data.cnt : null);
    if (currentCounter !== null) {
      const el = document.getElementById('telemetryData');
      if (el) el.innerText = `# ${currentCounter}`;
    } else if (data.val !== undefined) {
      const el = document.getElementById('telemetryData');
      if (el) el.innerText = data.val;
    }

    // Поддержка ключей uptime / up
    const currentUptime = data.uptime !== undefined ? data.uptime : (data.up !== undefined ? data.up : null);
    if (currentUptime !== null) {
      const uptimeEl = document.getElementById('uptimeData');
      if (uptimeEl) uptimeEl.innerText = `${currentUptime} с`;
    }
  }
}

const app = new MainApp();
document.addEventListener("DOMContentLoaded", () => app.init());
