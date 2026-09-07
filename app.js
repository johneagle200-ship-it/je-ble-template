class MainApp extends BaseBLEDevice {
  constructor() {
    super({
      repoOwner: "johneagle200-ship-it",
      repoName: "je-ble-template"
    });
  }

  async init() {
    // 1. Отображаем версию веб-приложения сразу при запуске
    this.loadAppVersion();

    // 2. Запускаем инициализацию BLE базового класса
    if (super.init) {
      await super.init();
    }
  }

  async loadAppVersion() {
    try {
      const res = await fetch('./package.json');
      const pkg = await res.json();
      const ver = `v${pkg.version}`;

      const headerEl = document.getElementById('appVersionHeader');
      const menuEl = document.getElementById('appVersion');

      if (headerEl) headerEl.innerText = ver;
      if (menuEl) menuEl.innerText = ver;
    } catch (err) {
      console.error('Ошибка загрузки package.json:', err);
    }
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

    // 2. Выводим время работы ESP32 (в секундах)
    if (data.uptime !== undefined) {
      const uptimeEl = document.getElementById('uptimeData');
      if (uptimeEl) uptimeEl.innerText = `${data.uptime} с`;
    }
  }
}

const app = new MainApp();
document.addEventListener("DOMContentLoaded", () => app.init());
