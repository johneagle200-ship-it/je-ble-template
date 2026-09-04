class BaseBLEDevice {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    this.serviceUuid = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
    this.rxUuid = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
    this.txUuid = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
    this.namePrefix = "JE_";

    this.currentAppVersion = config.appVersion || "1.0.0";
    this.espFwVersion = null;
    this.latestRemoteVersion = null;

    this.connectedDeviceId = null;
    this.isExplicitDisconnect = false;
    this.reconnectTimer = null;
    this.isOtaInProgress = false;

    this.BluetoothLe = window.Capacitor?.Plugins?.BluetoothLe || (typeof Capacitor !== 'undefined' ? Capacitor.Plugins.BluetoothLe : null);
  }

  async init() {
    this.updateVersionUI();
    await this.loadAppVersion();

    if (this.BluetoothLe) {
      try {
        await this.BluetoothLe.initialize();
        await this.BluetoothLe.requestPermissions();

        await new Promise(r => setTimeout(r, 500));

        try {
          await this.BluetoothLe.addListener('disconnected', (info) => {
            console.log("[JE Core] Связь потеряна:", info);
            if (!this.isExplicitDisconnect && this.connectedDeviceId) {
              this.updateUI("reconnecting");
              this.scheduleReconnect(1000);
            } else {
              this.updateUI("disconnected");
            }
          });
        } catch (err) {
          console.log("[JE Core] Слушатель событий BLE уже инициализирован");
        }

        const savedName = localStorage.getItem("savedDeviceName");
        if (savedName) {
          const el = document.getElementById('deviceName');
          if (el) el.innerText = savedName;
        }

        const savedId = localStorage.getItem("savedDeviceId");
        if (savedId) {
          this.connectedDeviceId = savedId;
          this.isExplicitDisconnect = false;
          this.connectNativeBLE(savedId);
        }
      } catch (e) {
        console.error("[JE Core] Ошибка инициализации BLE:", e);
        const savedId = localStorage.getItem("savedDeviceId");
        if (savedId) {
          this.connectedDeviceId = savedId;
          this.isExplicitDisconnect = false;
          this.scheduleReconnect(2000);
        }
      }
    }

    setTimeout(() => this.checkForUpdates(), 3000);
  }

  async loadAppVersion() {
    try {
      const res = await fetch('./package.json');
      if (res.ok) {
        const pkg = await res.json();
        if (pkg.version) {
          this.currentAppVersion = pkg.version;
          this.updateVersionUI();
        }
      }
    } catch (e) {
      this.updateVersionUI();
    }
  }

  updateVersionUI() {
    const versionEl = document.getElementById('appVersion');
    if (versionEl) versionEl.innerText = `v${this.currentAppVersion}`;

    const espVerEl = document.getElementById('espFwVersion');
    if (espVerEl) {
      espVerEl.innerText = `v${this.espFwVersion || this.currentAppVersion}`;
    }

    const espTextEl = document.getElementById('espFwText');
    if (espTextEl) {
      espTextEl.innerText = `v${this.espFwVersion || this.currentAppVersion}`;
    }
  }

  isNewerVersion(remote, current) {
    if (!remote || !current) return false;
    const r = remote.split('.').map(Number);
    const c = current.split('.').map(Number);
    for (let i = 0; i < Math.max(r.length, c.length); i++) {
      const rN = r[i] || 0, cN = c[i] || 0;
      if (rN > cN) return true;
      if (rN < cN) return false;
    }
    return false;
  }

  async checkForUpdates() {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/main/package.json`);
      if (!res.ok) return;
      const pkg = await res.json();
      const remoteVersion = pkg.version;

      if (!remoteVersion) return;
      this.latestRemoteVersion = remoteVersion;

      let hasUpdate = false;

      if (this.isNewerVersion(remoteVersion, this.currentAppVersion)) {
        hasUpdate = true;
        const textEl = document.getElementById('updateNoticeText');
        const btnApp = document.getElementById('btnUpdateApp');
        const noticeEl = document.getElementById('updateNotice');
        if (textEl) textEl.innerText = `Доступна новая версия приложения v${remoteVersion}!`;
        if (btnApp) btnApp.style.display = 'inline-block';
        if (noticeEl) noticeEl.style.display = 'block';
      }

      if (this.espFwVersion && this.isNewerVersion(remoteVersion, this.espFwVersion)) {
        hasUpdate = true;
        const textEl = document.getElementById('updateNoticeText');
        const btnFw = document.getElementById('btnUpdateFW');
        const noticeEl = document.getElementById('updateNotice');
        if (textEl) textEl.innerText = `Доступна новая прошивка ESP32 v${this.latestRemoteVersion}!`;
        if (btnFw) btnFw.style.display = 'inline-block';
        if (noticeEl) noticeEl.style.display = 'block';
      }

      if (hasUpdate) {
        const badge = document.getElementById('menuBadge');
        if (badge) badge.style.display = 'block';
      }
    } catch (e) {
      console.log("[JE Core] Ошибка проверки обновлений:", e);
    }
  }

  updateApp() {
    const apkUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/app-debug.apk`;
    window.open(apkUrl, '_system');
  }

  async connectOrReconnect() {
    this.isExplicitDisconnect = false;
    clearTimeout(this.reconnectTimer);
    if (this.connectedDeviceId) this.connectNativeBLE(this.connectedDeviceId);
    else this.selectNewDevice();
  }

  async selectNewDevice() {
    try {
      this.isExplicitDisconnect = true;
      clearTimeout(this.reconnectTimer);
      this.updateUI("connecting");

      // Системный диалог поиска и выбора устройств
      const result = await this.BluetoothLe.requestDevice({
        displayUnconnected: true
      });

      if (result && result.deviceId) {
        const deviceName = result.name || result.deviceId;
        this.connectedDeviceId = result.deviceId;

        localStorage.setItem("savedDeviceId", result.deviceId);
        localStorage.setItem("savedDeviceName", deviceName);

        const devNameEl = document.getElementById('deviceName');
        if (devNameEl) devNameEl.innerText = deviceName;

        this.isExplicitDisconnect = false;
        this.connectNativeBLE(result.deviceId);
      } else {
        this.updateUI("disconnected");
      }
    } catch (e) {
      console.log("[JE Core] Отмена или ошибка выбора устройства:", e);
      this.updateUI("disconnected");
    }
  }

  async stopDeviceScan(listener) {
    try {
      if (listener) await listener.remove();
      await this.BluetoothLe.stopScan();
    } catch (e) {}
  }

  async connectNativeBLE(deviceId) {
    if (!deviceId) return;
    try {
      clearTimeout(this.reconnectTimer);
      this.updateUI("connecting");

      await this.BluetoothLe.connect({ deviceId });
      await this.BluetoothLe.startNotifications({
        deviceId,
        service: this.serviceUuid,
        characteristic: this.txUuid
      }, (result) => this._parseData(result));

      this.updateUI("connected");
      this.sendCmd(JSON.stringify({ cmd: "get_sys" }));

    } catch (err) {
      if (!this.isExplicitDisconnect) {
        this.updateUI("reconnecting");
        this.scheduleReconnect(3000);
      } else {
        this.updateUI("disconnected");
      }
    }
  }

  async disconnectBLE() {
    this.isExplicitDisconnect = true;
    clearTimeout(this.reconnectTimer);
    if (this.connectedDeviceId) {
      try { await this.BluetoothLe.disconnect({ deviceId: this.connectedDeviceId }); } catch (e) {}
    }
    this.updateUI("disconnected");
  }

  scheduleReconnect(delayMs) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isExplicitDisconnect && this.connectedDeviceId) {
        this.connectNativeBLE(this.connectedDeviceId);
      }
    }, delayMs);
  }

  _parseData(result) {
    if (this.isOtaInProgress) return;

    try {
      const rawVal = result.value || result;
      let bytes = rawVal.buffer ? new Uint8Array(rawVal.buffer) : new Uint8Array(rawVal);
      const jsonStr = new TextDecoder().decode(bytes);
      const data = JSON.parse(jsonStr);

      if (data.sys) {
        this.espFwVersion = data.sys.fw;
        this.updateVersionUI();

        if (this.latestRemoteVersion && this.isNewerVersion(this.latestRemoteVersion, data.sys.fw)) {
          const textEl = document.getElementById('updateNoticeText');
          const btnFw = document.getElementById('btnUpdateFW');
          const noticeEl = document.getElementById('updateNotice');
          if (textEl) textEl.innerText = `Доступна новая прошивка ESP32 v${this.latestRemoteVersion}!`;
          if (btnFw) btnFw.style.display = 'inline-block';
          if (noticeEl) noticeEl.style.display = 'block';

          const badge = document.getElementById('menuBadge');
          if (badge) badge.style.display = 'block';
        }
        return;
      }

      this.onTelemetry(data);
    } catch (e) {}
  }

  async updateESP32Firmware() {
    if (!confirm(`Начать прошивку ESP32 до версии v${this.latestRemoteVersion}? Не отключайте устройство!`)) return;

    try {
      this.isOtaInProgress = true;
      const statusEl = document.getElementById('bleStatus');
      if (statusEl) statusEl.innerText = "Загрузка файла...";

      const binUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/firmware.bin`;
      const res = await fetch(binUrl);
      if (!res.ok) throw new Error("Не удалось скачать firmware.bin с GitHub");

      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      await this.sendCmd(JSON.stringify({ cmd: "OTA_START", size: bytes.length }));
      await new Promise(r => setTimeout(r, 1000));

      const chunkSize = 200;
      const total = bytes.length;

      for (let offset = 0; offset < total; offset += chunkSize) {
        const chunk = bytes.slice(offset, offset + chunkSize);
        await this.BluetoothLe.write({
          deviceId: this.connectedDeviceId,
          service: this.serviceUuid,
          characteristic: this.rxUuid,
          value: Array.from(chunk)
        });

        let percent = Math.round((offset / total) * 100);
        if (statusEl) statusEl.innerText = `Прошивка ESP32: ${percent}%`;
      }

      await this.sendCmd(JSON.stringify({ cmd: "OTA_END" }));
      alert("Прошивка успешно завершена! ESP32 перезагружается.");
      this.isOtaInProgress = false;
      this.disconnectBLE();

    } catch (e) {
      alert("Ошибка прошивки: " + e.message);
      this.isOtaInProgress = false;
      this.updateUI("connected");
    }
  }

  async sendCmd(cmd) {
    if (!this.connectedDeviceId) return;
    try {
      const numbers = Array.from(new TextEncoder().encode(cmd));
      await this.BluetoothLe.write({
        deviceId: this.connectedDeviceId,
        service: this.serviceUuid,
        characteristic: this.rxUuid,
        value: numbers
      });
    } catch (e) {}
  }

  onTelemetry(data) {}

  updateUI(state) {
    const statusEl = document.getElementById('bleStatus');
    const statusInMenu = document.getElementById('bleStatusInMenu');
    const bottomBar = document.getElementById('bottomConnectBar');
    const btnDisconnect = document.getElementById('btnDisconnect');

    let textState = "Отключено";

    if (state === "connected") {
      textState = "Подключено";
      if (statusEl) statusEl.className = "status connected";
      if (bottomBar) bottomBar.style.display = "none";
      if (btnDisconnect) btnDisconnect.style.display = "block";
    } else if (state === "connecting" || state === "reconnecting") {
      textState = state === "connecting" ? "Подключение..." : "Поиск...";
      if (statusEl) statusEl.className = "status pending";
      if (bottomBar) bottomBar.style.display = "none";
      if (btnDisconnect) btnDisconnect.style.display = "block";
    } else {
      textState = "Отключено";
      if (statusEl) statusEl.className = "status";
      if (bottomBar) bottomBar.style.display = "block";
      if (btnDisconnect) btnDisconnect.style.display = "none";
    }

    if (statusEl) statusEl.innerText = textState;
    if (statusInMenu) statusInMenu.innerText = textState;
  }
}
