class BaseBLEDevice {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    this.serviceUuid = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
    this.rxUuid = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
    this.txUuid = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
    this.namePrefix = "JE_";

    this.currentAppVersion = "0.0.0";
    this.espFwVersion = null;
    this.latestRemoteVersion = null;

    this.connectedDeviceId = null;
    this.isExplicitDisconnect = false;
    this.reconnectTimer = null;
    this.isOtaInProgress = false;

    this.BluetoothLe = window.Capacitor?.Plugins?.BluetoothLe || (typeof Capacitor !== 'undefined' ? Capacitor.Plugins.BluetoothLe : null);
  }

  async init() {
    await this.loadAppVersion();

    if (this.BluetoothLe) {
      try {
        await this.BluetoothLe.initialize();
        await this.BluetoothLe.requestPermissions();

        const savedName = localStorage.getItem("savedDeviceName");
        if (savedName) {
          const el = document.getElementById('deviceName');
          if (el) el.innerText = savedName;
        }

        const savedId = localStorage.getItem("savedDeviceId");
        if (savedId) {
          this.connectedDeviceId = savedId;
          this.connectNativeBLE(savedId);
        }
      } catch (e) {
        console.error("[JE Core] Ошибка инициализации BLE:", e);
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
          const versionEl = document.getElementById('appVersion');
          if (versionEl) versionEl.innerText = `v${this.currentAppVersion}`;
        }
      }
    } catch (e) {}
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

      // 1. Проверка мобильного приложения
      if (this.isNewerVersion(remoteVersion, this.currentAppVersion)) {
        const textEl = document.getElementById('updateNoticeText');
        const btnApp = document.getElementById('btnUpdateApp');
        const noticeEl = document.getElementById('updateNotice');
        if (textEl) textEl.innerText = `Доступна новая версия приложения v${remoteVersion}!`;
        if (btnApp) btnApp.style.display = 'inline-block';
        if (noticeEl) noticeEl.style.display = 'block';
      }

      // 2. Проверка прошивки ESP32
      if (this.espFwVersion && this.isNewerVersion(remoteVersion, this.espFwVersion)) {
        const textEl = document.getElementById('updateNoticeText');
        const btnFw = document.getElementById('btnUpdateFW');
        const noticeEl = document.getElementById('updateNotice');
        if (textEl) textEl.innerText = `Доступна новая прошивка ESP32 v${remoteVersion}!`;
        if (btnFw) btnFw.style.display = 'inline-block';
        if (noticeEl) noticeEl.style.display = 'block';
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

      const device = await this.BluetoothLe.requestDevice({
        namePrefix: this.namePrefix
      });

      if (device && device.deviceId) {
        this.connectedDeviceId = device.deviceId;

        // Очищаем имя от системных адресов или скобок, оставляем только чистое имя
        let devName = device.name || device.localName || "JE_Device";
        devName = devName.split('(')[0].trim();

        localStorage.setItem("savedDeviceId", this.connectedDeviceId);
        localStorage.setItem("savedDeviceName", devName);

        const devNameEl = document.getElementById('deviceName');
        if (devNameEl) devNameEl.innerText = devName;

        this.isExplicitDisconnect = false;
        this.connectNativeBLE(this.connectedDeviceId);
      }
    } catch (e) {
      this.updateUI("disconnected");
    }
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
        const espVerEl = document.getElementById('espFwVersion');
        if (espVerEl) espVerEl.innerText = `(FW: v${data.sys.fw})`;

        if (this.latestRemoteVersion && this.isNewerVersion(this.latestRemoteVersion, data.sys.fw)) {
          const textEl = document.getElementById('updateNoticeText');
          const btnFw = document.getElementById('btnUpdateFW');
          const noticeEl = document.getElementById('updateNotice');
          if (textEl) textEl.innerText = `Доступна новая прошивка ESP32 v${this.latestRemoteVersion}!`;
          if (btnFw) btnFw.style.display = 'inline-block';
          if (noticeEl) noticeEl.style.display = 'block';
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
    const btnConnect = document.getElementById('btnConnect');
    const btnDisconnect = document.getElementById('btnDisconnect');
    if (!statusEl) return;

    if (state === "connected") {
      statusEl.innerText = "Подключено";
      statusEl.className = "status connected";
      if (btnConnect) btnConnect.style.display = "none";
      if (btnDisconnect) btnDisconnect.style.display = "inline-block";
    } else if (state === "connecting" || state === "reconnecting") {
      statusEl.innerText = state === "connecting" ? "Подключение..." : "Поиск...";
      statusEl.className = "status pending";
      if (btnConnect) btnConnect.style.display = "none";
      if (btnDisconnect) btnDisconnect.style.display = "inline-block";
    } else {
      statusEl.innerText = "Отключено";
      statusEl.className = "status";
      if (btnConnect) {
        btnConnect.style.display = "inline-block";
        btnConnect.innerText = this.connectedDeviceId ? "Подключить" : "Найти устройство";
      }
      if (btnDisconnect) btnDisconnect.style.display = "none";
    }
  }
}
