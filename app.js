class MainApp extends BaseBLEDevice {
  constructor() {
    super({
      repoOwner: "johneagle200-ship-it",
      repoName: "je-ble-template"
    });
  }

  onTelemetry(data) {
    if (data.val !== undefined) {
      document.getElementById('telemetryData').innerText = data.val;
    }
  }
}

const app = new MainApp();
document.addEventListener("DOMContentLoaded", () => app.init());
