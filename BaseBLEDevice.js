class BaseBLEDevice {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    this.serviceUuid = config.serviceUuid || "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
    this.rxUuid = config.rxUuid || "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
    this.txUuid = config.txUuid || "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
    this.namePrefix = config.namePrefix || "JE_";

    this.espFwVersion = null;

    this.connectedDeviceId = null;
    this.isConnecting = false;
    this.isExplicitDisconnect = false;
    this.reconnectTimer = null;
    this.isOtaInProgress = false;

    this.hasPermissions = false;

    this.rxBuffer = "";
    this.streamDecoder = new TextDecoder('utf-8');
    this.maxBufferSize = config.maxBufferSize || 16384;
    this.currentMtu = 23;

    // Кеш наиболее совместимого формата отправки для плагина (DataView/Base64/Array)
    this.preferredWriteFormat = null; 

    this.valueListener = null;
    this.disconnectListener = null;
    this.BluetoothLe = window.Capacitor?.Plugins?.BluetoothLe || (typeof Capacitor !== 'undefined' ? Capacitor.Plugins.BluetoothLe : null);

    console.log("[JE Core] Инициализирован модуль BaseBLEDevice");
  }

  async init() {
    console.log("[JE Core] Запуск процесса инициализации BLE...");

    if (!this.BluetoothLe) {
      console.warn("[JE Core] Плагин Capacitor BluetoothLe не обнаружен!");
      return;
    }

    try {
      try {
        await this.BluetoothLe.initialize();
      } catch (initErr) {
        console.warn("[JE Core] Предупреждение инициализации BLE:", initErr);
      }

      await this.ensurePermissions();

      if (!this.disconnectListener) {
        try {
          this.disconnectListener = await this.BluetoothLe.addListener('disconnected', (info) => {
            console.warn("[JE Core] [Событие] Связь с устройством потеряна:", info);
            this.isConnecting = false;
            if (!this.isExplicitDisconnect && this.connectedDeviceId) {
              console.log("[JE Core] Запуск авто-переподключения...");
              this.updateUI("reconnecting");
              this.scheduleReconnect(1500);
            } else {
              this.updateUI("disconnected");
            }
          });
        } catch (err) {
          console.warn("[JE Core] Ошибка регистрации слушателя отключения:", err);
        }
      }

      const savedName = localStorage.getItem("savedDeviceName");
      if (savedName) {
        const el = document.getElementById('deviceName');
        if (el) el.innerText = savedName;
      }

      // --- АВТОПОДКЛЮЧЕНИЕ ВРЕМЕННО ОТКЛЮЧЕНО ДЛЯ ОТЛАДКИ ---
      /*const savedId = localStorage.getItem("savedDeviceId");
      if (savedId) {
        console.log(`[JE Core] Найдено сохраненное ID: ${savedId}. Автоподключение...`);
        this.connectedDeviceId = savedId;
        this.isExplicitDisconnect = false;
        this.connectNativeBLE(savedId);
      }*/
    } catch (e) {
      console.error("[JE Core] Ошибка при инициализации BLE:", e);
    }
  }

  async ensurePermissions() {
    try {
      if (typeof this.BluetoothLe.checkPermissions === 'function') {
        const status = await this.BluetoothLe.checkPermissions();
        
        const connectGranted = status?.bluetoothConnect === 'granted' || status?.display === 'granted';
        const scanGranted = status?.bluetoothScan === 'granted' || status?.display === 'granted';

        if (connectGranted && scanGranted) {
          this.hasPermissions = true;
          return;
        }
      }

      if (typeof this.BluetoothLe.requestPermissions === 'function') {
        await this.BluetoothLe.requestPermissions();
      }
      this.hasPermissions = true;
    } catch (permErr) {
      console.warn("[JE Core] Предупреждение запроса разрешений:", permErr);
      this.hasPermissions = true;
    }
  }

  updateEspFwUI() {
    const espVerEl = document.getElementById('espFwVersion');
    if (espVerEl) espVerEl.innerText = `v${this.espFwVersion || '---'}`;

    const espTextEl = document.getElementById('espFwText');
    if (espTextEl) espTextEl.innerText = `v${this.espFwVersion || '---'}`;
  }

  async connectOrReconnect() {
    this.isExplicitDisconnect = false;
    clearTimeout(this.reconnectTimer);
    if (this.connectedDeviceId) {
      this.connectNativeBLE(this.connectedDeviceId);
    } else {
      this.selectNewDevice();
    }
  }

async selectNewDevice() {
    if (this.isConnecting) return;

    // Принудительно запрашиваем расширенные разрешения перед поиском для совместимости с Honor/Android 12+
    await this.ensurePermissions();

    try {
      this.isConnecting = true;
      this.isExplicitDisconnect = true;
      clearTimeout(this.reconnectTimer);
      this.updateUI("connecting");

      let result = null;
      try {
        result = await this.BluetoothLe.requestDevice({ 
          displayUnconnected: true,
          optionalServices: [this.serviceUuid]
        });
      } catch (nativeEx) {
        console.error("[JE Core] Нативный сбой при сканировании BLE:", nativeEx);
        alert("Не удалось запустить поиск BLE. Проверьте разрешения геолокации и Bluetooth в настройках телефона.");
        this.isConnecting = false;
        this.updateUI("disconnected");
        return;
      }

      if (result && result.deviceId) {
        const deviceName = result.name || result.deviceId;
        this.connectedDeviceId = result.deviceId;

        localStorage.setItem("savedDeviceId", result.deviceId);
        localStorage.setItem("savedDeviceName", deviceName);

        const devNameEl = document.getElementById('deviceName');
        if (devNameEl) devNameEl.innerText = deviceName;

        this.isExplicitDisconnect = false;
        this.isConnecting = false; 
        this.connectNativeBLE(result.deviceId);
      } else {
        this.isConnecting = false;
        this.updateUI("disconnected");
      }
    } catch (e) {
      console.warn("[JE Core] Отмена выбора устройства:", e);
      this.isConnecting = false;
      this.updateUI("disconnected");
    }
  }
  async connectNativeBLE(deviceId) {
    if (this.isConnecting) return;

    if (!deviceId) {
      console.warn("[JE Core] Ошибка: deviceId не передан!");
      return;
    }

    await this.ensurePermissions();

    try {
      this.isConnecting = true;
      clearTimeout(this.reconnectTimer);
      this.updateUI("connecting");

      this.rxBuffer = "";
      this.streamDecoder = new TextDecoder('utf-8');
      this.currentMtu = 23;

      await this.BluetoothLe.connect({ deviceId, timeout: 10000 });

      // Пауза для стабилизации GATT-стека на Android
      await new Promise(r => setTimeout(r, 500));

      try {
        const mtuRes = await this.BluetoothLe.requestMtu({ deviceId, mtu: 247 });
        if (mtuRes && mtuRes.mtu) {
          this.currentMtu = mtuRes.mtu;
        }
      } catch (mtuErr) {
        console.warn("[JE Core] MTU отклонен (используем 23):", mtuErr);
      }

      await new Promise(r => setTimeout(r, 200));

      if (!this.valueListener) {
        this.valueListener = await this.BluetoothLe.addListener(
          'characteristicValueReceived',
          (result) => this._parseData(result)
        );
      }

      try {
        await this.BluetoothLe.stopNotifications({
          deviceId,
          service: this.serviceUuid,
          characteristic: this.txUuid
        }).catch(() => {});

        await this.BluetoothLe.startNotifications({
          deviceId,
          service: this.serviceUuid,
          characteristic: this.txUuid
        });
      } catch (notifErr) {
        console.error("[JE Core] Не удалось активировать TX notifications:", notifErr);
      }

      this.updateUI("connected");

      await new Promise(r => setTimeout(r, 400));
      await this.sendCmd(JSON.stringify({ cmd: "get_sys" }));

    } catch (err) {
      console.error(`[JE Core] Ошибка подключения к ${deviceId}:`, err);
      if (!this.isExplicitDisconnect) {
        this.updateUI("reconnecting");
        this.scheduleReconnect(3000);
      } else {
        this.updateUI("disconnected");
      }
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnectBLE() {
    this.isExplicitDisconnect = true;
    clearTimeout(this.reconnectTimer);
    
    if (this.connectedDeviceId && this.BluetoothLe) {
      try { 
        await this.BluetoothLe.stopNotifications({
          deviceId: this.connectedDeviceId,
          service: this.serviceUuid,
          characteristic: this.txUuid
        }).catch(() => {});
        
        await this.BluetoothLe.disconnect({ deviceId: this.connectedDeviceId }); 
      } catch (e) {
        console.warn("[JE Core] Ошибка при отключении:", e);
      }
    }
    this.rxBuffer = "";
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
    if (this.isOtaInProgress || !result) return;

    try {
      const rawVal = result?.value !== undefined ? result.value : result;
      if (rawVal === undefined || rawVal === null) return;

      let bytes;

      if (rawVal instanceof Uint8Array) {
        bytes = rawVal;
      } else if (rawVal instanceof DataView) {
        bytes = new Uint8Array(rawVal.buffer, rawVal.byteOffset, rawVal.byteLength);
      } else if (rawVal && rawVal.buffer instanceof ArrayBuffer) {
        bytes = new Uint8Array(rawVal.buffer, rawVal.byteOffset || 0, rawVal.byteLength || rawVal.buffer.byteLength);
      } else if (typeof rawVal === 'string') {
        try {
          const binaryString = window.atob(rawVal);
          bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
        } catch (b64Err) {
          bytes = new TextEncoder().encode(rawVal);
        }
      } else if (Array.isArray(rawVal)) {
        bytes = new Uint8Array(rawVal);
      } else if (typeof rawVal === 'object') {
        bytes = new Uint8Array(Object.values(rawVal));
      } else {
        return;
      }

      this.rxBuffer += this.streamDecoder.decode(bytes, { stream: true });

      if (this.rxBuffer.length > this.maxBufferSize) {
        console.warn("[JE Core] Буфер переполнен, сброс!");
        this.rxBuffer = "";
        return;
      }

      let idx;
      while ((idx = this.rxBuffer.indexOf('\n')) !== -1) {
        const line = this.rxBuffer.substring(0, idx).trim();
        this.rxBuffer = this.rxBuffer.substring(idx + 1);
        if (!line) continue;

        try {
          const data = JSON.parse(line);

          if (data.sys) {
            this.espFwVersion = typeof data.sys === 'object' ? data.sys.fw : data.sys;
            this.updateEspFwUI();
          }

          if (typeof this.onTelemetry === 'function') {
            this.onTelemetry(data);
          }
        } catch (e) {
          console.warn("[JE Core] Ошибка парсинга JSON:", line);
        }
      }
    } catch (e) {
      console.error("[JE Core] Ошибка в _parseData:", e);
    }
  }

  async _writeRaw(options) {
    try {
      await this.BluetoothLe.write(options);
      return true;
    } catch (e1) {
      if (typeof this.BluetoothLe.writeWithoutResponse === 'function') {
        await this.BluetoothLe.writeWithoutResponse(options);
        return true;
      }
      throw e1;
    }
  }

  async _sendBytes(uint8Bytes) {
    if (!this.connectedDeviceId || !this.BluetoothLe) return;

    const getVariant = (type) => {
      if (type === 'dataview') return new DataView(uint8Bytes.buffer, uint8Bytes.byteOffset, uint8Bytes.byteLength);
      if (type === 'base64') {
        let binary = "";
        for (let i = 0; i < uint8Bytes.length; i++) {
          binary += String.fromCharCode(uint8Bytes[i]);
        }
        return window.btoa(binary);
      }
      if (type === 'array') return Array.from(uint8Bytes);
      return null;
    };

    if (this.preferredWriteFormat) {
      try {
        await this._writeRaw({
          deviceId: this.connectedDeviceId,
          service: this.serviceUuid,
          characteristic: this.rxUuid,
          value: getVariant(this.preferredWriteFormat)
        });
        return;
      } catch (e) {
        this.preferredWriteFormat = null;
      }
    }

    const formats = ['dataview', 'base64', 'array'];
    let lastErr = null;

    for (const fmt of formats) {
      try {
        const val = getVariant(fmt);
        await this._writeRaw({
          deviceId: this.connectedDeviceId,
          service: this.serviceUuid,
          characteristic: this.rxUuid,
          value: val
        });
        this.preferredWriteFormat = fmt;
        return;
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error("Все форматы записи отклонены плагином");
  }

  async sendCmd(cmd) {
    if (!this.connectedDeviceId || !this.BluetoothLe) return;
    try {
      const formattedCmd = cmd.endsWith('\n') ? cmd : cmd + '\n';
      const bytes = new TextEncoder().encode(formattedCmd);
      await this._sendBytes(bytes);
    } catch (e) {
      console.error("[JE Core] Ошибка отправки команды:", e);
    }
  }

  async updateESP32Firmware() {
    if (!confirm("Начать прошивку ESP32 по BLE?")) return;

    try {
      this.isOtaInProgress = true;
      const statusEl = document.getElementById('bleStatus');
      if (statusEl) statusEl.innerText = "Загрузка файла...";

      const binUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/firmware.bin`;
      const res = await fetch(binUrl);
      if (!res.ok) throw new Error(`Ошибка загрузки firmware.bin (Код: ${res.status})`);

      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      await this.sendCmd(JSON.stringify({ cmd: "OTA_START", size: bytes.length }));
      await new Promise(r => setTimeout(r, 1000));

      const chunkSize = Math.min(244, Math.max(20, (this.currentMtu || 23) - 3));
      const total = bytes.length;

      for (let offset = 0; offset < total; offset += chunkSize) {
        const chunk = bytes.slice(offset, offset + chunkSize);
        await this._sendBytes(chunk);

        await new Promise(r => setTimeout(r, 10));

        const percent = Math.round((offset / total) * 100);
        if (statusEl && offset % (chunkSize * 5) === 0) {
          statusEl.innerText = `Прошивка ESP32: ${percent}%`;
        }
      }

      await new Promise(r => setTimeout(r, 200));
      await this.sendCmd(JSON.stringify({ cmd: "OTA_END" }));
      
      alert("Прошивка успешно завершена! ESP32 перезагружается.");
      this.isOtaInProgress = false;
      this.disconnectBLE();

    } catch (e) {
      console.error("[JE Core] Ошибка OTA:", e);
      alert("Ошибка прошивки: " + e.message);
      this.isOtaInProgress = false;
      this.updateUI("connected");
    }
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
      
      const telemetryEl = document.getElementById('telemetryData');
      if (telemetryEl) telemetryEl.innerText = "--";
    }

    if (statusEl) statusEl.innerText = textState;
    if (statusInMenu) statusInMenu.innerText = textState;
  }
}
