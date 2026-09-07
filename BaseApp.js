class BaseApp {
  constructor(config) {
    this.updater = new AppUpdater(config);
    // Наследуем BLE-функции из BaseBLEDevice
    this.ble = new BaseBLEDevice(config);
  }

  async init() {
    // 1. Мгновенно выводим версию клиента
    await this.updater.init();

    // 2. Инициализируем BLE
    if (this.ble && typeof this.ble.init === 'function') {
      await this.ble.init();
    }
  }

  // Делегируем вызовы кнопок из index.html
  checkForUpdates() { this.updater.checkForUpdates(); }
  updateApp() { this.updater.updateApp(); }
  connectOrReconnect() { this.ble.connectOrReconnect(); }
  disconnectBLE() { this.ble.disconnectBLE(); }
  selectNewDevice() { this.ble.selectNewDevice(); }
  updateESP32Firmware() { this.ble.updateESP32Firmware(); }
}
