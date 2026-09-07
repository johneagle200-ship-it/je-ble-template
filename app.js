class MainApp extends BaseApp {
  constructor() {
    super({
      repoOwner: "johneagle200-ship-it",
      repoName: "je-ble-template"
    });
  }

  onTelemetry(data) {
    if (data.counter !== undefined) {
      const el = document.getElementById('telemetryData');
      if (el) el.innerText = `# ${data.counter}`;
    } else if (data.val !== undefined) {
      const el = document.getElementById('telemetryData');
      if (el) el.innerText = data.val;
    }

    if (data.uptime !== undefined) {
      const uptimeEl = document.getElementById('uptimeData');
      if (uptimeEl) uptimeEl.innerText = `${data.uptime} с`;
    }
  }
}

const app = new MainApp();
document.addEventListener("DOMContentLoaded", () => app.init());
