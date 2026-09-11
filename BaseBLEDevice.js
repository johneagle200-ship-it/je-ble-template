class BaseBLEDevice {
  constructor(config = {}) {
    // Настройка репозитория для OTA-обновлений по умолчанию
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    
    // BLE UUID (Nordic UART Service по умолчанию)
    this.serviceUuid = (config.serviceUuid || "6e400001-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
    this.rxUuid = (config.rxUuid || "6e400002-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
    this.txUuid = (config.txUuid || "6e400003-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
    this.namePrefix = config.namePrefix || "JE_";

    // Флаги состояния и автоподключения
    this.autoConnect = config.autoConnect !== undefined ? config.autoConnect : true;
    this.autoConnectBlocked = false;
    this.espFwVersion = null;

    this.connectedDeviceId = null;
    this.isConnecting = false;
    this.isExplicitDisconnect = false;
    this.reconnectTimer = null;
    this.isOtaInProgress = false;

    this.connectionSessionId = 0;
    this._writeQueue = Promise.resolve();

    this.minStableSessionMs = config.minStableSessionMs || 5000;
    this.stableTimer = null;
    this.currentStep = "IDLE";

    this.hasPermissions = false;

    // Буферы и декодер для входящего потока данных
    this.rxBuffer = "";
    this.streamDecoder = new TextDecoder('utf-8', { fatal: false });
    this.maxBufferSize = config.maxBufferSize || 16384;
    this.currentMtu = 23;

    // Слушатели и плагин Capacitor BluetoothLe
    this.valueListener = null;
    this.disconnectListener = null;
    this.BluetoothLe = window.Capacitor?.Plugins?.BluetoothLe || (typeof Capacitor !== 'undefined' ? Capacitor.Plugins.BluetoothLe : null);

    // Коллбэки приложения
    this.onTelemetryCallback = config.onTelemetry || null;
    this.onStatusChangeCallback = config.onStatusChange || null;
    this.onOtaProgressCallback = config.onOtaProgress || null;

    this._log("[JE Core] Модуль BaseBLEDevice инициализирован.");
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _getCrcTable() {
    if (this._crcTable) return this._crcTable;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    this._crcTable = table;
    return table;
  }

  _calculateCRC32(bytes) {
    let c = ~0;
    const table = this._getCrcTable();
    for (let i = 0; i < bytes.length; i++) {
      c = (c >>> 8) ^ table[(c ^ bytes[i]) & 0xFF];
    }
    return ~c >>> 0;
  }

  _log(msg, level = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] [${level.toUpperCase()}] ${msg}`;
    
    if (level === "error") console.error(formatted);
    else if (level === "warn") console.warn(formatted);
    else console.log(formatted);

    try {
      const logs = JSON.parse(localStorage.getItem("ble_debug_logs") || "[]");
      logs.push(formatted);
      if (logs.length > 100) logs.shift();
      localStorage.setItem("ble_debug_logs", JSON.stringify(logs));
    } catch (e) {}
  }

  getDebugLogs() {
    try {
      return JSON.parse(localStorage.getItem("ble_debug_logs") || "[]");
    } catch (e) {
      return [];
    }
  }

  clearDebugLogs() {
    localStorage.removeItem("ble_debug_logs");
    this._log("[JE Core] Журнал логов очищен.");
  }

  showLogsModal() {
    const modal = document.getElementById("crash-guard-modal");
    if (!modal) return;

    const lastStep = localStorage.getItem("ble_last_step") || "НЕИЗВЕСТНО";
    const logsText = this.getDebugLogs().join("\n");

    this._setElementText("crashLastStep", lastStep);

    const textarea = document.getElementById("crashLogTextarea");
    if (textarea) {
      textarea.value = logsText;
      textarea.scrollTop = textarea.scrollHeight;
    }

    const btnCopy = document.getElementById("btnCrashCopy");
    if (btnCopy) {
      btnCopy.onclick = () => {
        if (textarea) textarea.select();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(logsText).then(() => alert("Лог скопирован!")).catch(() => document.execCommand('copy'));
        } else {
          document.execCommand('copy');
          alert("Лог скопирован!");
        }
      };
    }

    const btnReset = document.getElementById("btnCrashReset");
    if (btnReset) {
      btnReset.onclick = () => {
        this.resetCrashLock();
        modal.style.display = "none";
        alert("Блокировка снята. Можно подключаться.");
      };
    }

    const btnClear = document.getElementById("btnClearLogs") || document.getElementById("btnCrashClear");
    if (btnClear) {
      btnClear.onclick = () => {
        this.clearDebugLogs();
        if (textarea) textarea.value = "";
      };
    }

    const btnClose = document.getElementById("btnCrashClose");
    if (btnClose) {
      btnClose.onclick = () => {
        modal.style.display = "none";
      };
    }

    modal.style.display = "flex";
  }

  _setCurrentStep(stepName) {
    this.currentStep = stepName;
    localStorage.setItem("ble_last_step", stepName);
    this._log(`[STEP] -> ${stepName}`);
  }

  resetCrashLock() {
    localStorage.removeItem("ble_crash_pending");
    this.autoConnectBlocked = false;
    this._log("[Crash Guard] Блокировка сбоя сброшена.");
  }

  async init() {
    this._log("[JE Core] Запуск процесса инициализации BLE...");

    if (localStorage.getItem("ble_crash_pending") === "1") {
      this.autoConnectBlocked = true;
      setTimeout(() => this.showLogsModal(), 300);
    }

    if (!this.BluetoothLe) return;

    try {
      try { await this.BluetoothLe.initialize(); } catch (initErr) {}
      await this.ensurePermissions();

      if (!this.disconnectListener) {
        try {
          this.disconnectListener = await this.BluetoothLe.addListener('disconnected', () => {
            this.connectionSessionId++; 
            this.isConnecting = false;
            clearTimeout(this.stableTimer);

            if (!this.isExplicitDisconnect && this.connectedDeviceId && !this.autoConnectBlocked) {
              this.updateUI("reconnecting");
              this.scheduleReconnect(3000);
            } else {
              this.updateUI("disconnected");
            }
          });
        } catch (err) {}
      }

      const savedName = localStorage.getItem("savedDeviceName");
      if (savedName) this._setElementText('deviceName', savedName);

      if (this.autoConnect && !this.autoConnectBlocked) {
        const savedId = localStorage.getItem("savedDeviceId");
        if (savedId) {
          this.connectedDeviceId = savedId;
          this.isExplicitDisconnect = false;
          this.connectNativeBLE(savedId);
        }
      } else if (this.autoConnectBlocked) {
        this.updateUI("crash_loop");
      }
    } catch (e) {}
  }

  async ensurePermissions() {
    if (this.hasPermissions) return;
    try {
      if (typeof this.BluetoothLe.checkPermissions === 'function') {
        const status = await this.BluetoothLe.checkPermissions();
        if ((status?.bluetoothConnect === 'granted' || status?.display === 'granted') &&
            (status?.bluetoothScan === 'granted' || status?.display === 'granted')) {
          this.hasPermissions = true;
          return;
        }
      }
      if (typeof this.BluetoothLe.requestPermissions === 'function') {
        await this.BluetoothLe.requestPermissions();
      }
      this.hasPermissions = true;
    } catch (permErr) {
      this.hasPermissions = true;
    }
  }

  updateEspFwUI() {
    const versionStr = `${this.espFwVersion || '--'}`;
    this._setElementText('espFwText', versionStr);
  }

  async connectOrReconnect() {
    this.resetCrashLock();
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
    await this.ensurePermissions();

    const currentSession = ++this.connectionSessionId;

    try {
      this.resetCrashLock();
      this.isConnecting = true;
      this.isExplicitDisconnect = true;
      clearTimeout(this.reconnectTimer);
      clearTimeout(this.stableTimer);
      
      this.updateUI("switching");

      if (this.connectedDeviceId && this.BluetoothLe) {
        if (this.valueListener) {
          try { await this.valueListener.remove(); } catch (e) {}
          this.valueListener = null;
        }

        try {
          await this.BluetoothLe.stopNotifications({
            deviceId: this.connectedDeviceId,
            service: this.serviceUuid,
            characteristic: this.txUuid
          }).catch(() => {});
          await this.BluetoothLe.disconnect({ deviceId: this.connectedDeviceId });
        } catch (discErr) {}

        this.connectedDeviceId = null;
        this.rxBuffer = "";
        await this._delay(500);
      }

      if (currentSession !== this.connectionSessionId) return;

      let result = null;
      try {
        result = await this.BluetoothLe.requestDevice({ 
          displayUnconnected: true,
          services: [this.serviceUuid],
          namePrefix: this.namePrefix,
          optionalServices: [this.serviceUuid]
        });
      } catch (nativeEx) {
        this.isConnecting = false;
        this.updateUI("disconnected");
        return;
      }

      if (currentSession !== this.connectionSessionId) return;

      if (result && result.deviceId) {
        const deviceName = result.name || result.localName || result.deviceId;
        this.connectedDeviceId = result.deviceId;

        localStorage.setItem("savedDeviceId", result.deviceId);
        localStorage.setItem("savedDeviceName", deviceName);
        this._setElementText('deviceName', deviceName);

        this.isExplicitDisconnect = false;
        this.isConnecting = false; 
        this.connectNativeBLE(result.deviceId);
      } else {
        this.isConnecting = false;
        this.updateUI("disconnected");
      }
    } catch (e) {
      this.isConnecting = false;
      this.updateUI("disconnected");
    }
  }
  
  async connectNativeBLE(deviceId) {
    if (!deviceId || !this.BluetoothLe || this.isConnecting) return;
  
    await this.ensurePermissions();
    const currentSession = ++this.connectionSessionId;
    const isAborted = () => currentSession !== this.connectionSessionId;
  
    try {
      this.isConnecting = true;
      clearTimeout(this.reconnectTimer);
      clearTimeout(this.stableTimer);
  
      localStorage.setItem("ble_crash_pending", "1");
      this.updateUI("connecting");
      this.rxBuffer = "";
      this.streamDecoder = new TextDecoder('utf-8', { fatal: false });
      this.currentMtu = 23;
  
      this._setCurrentStep("GATT_CONNECTING");
      await this.BluetoothLe.connect({ deviceId, timeout: 12000 });
      if (isAborted()) return;
  
      this._setCurrentStep("GATT_STABILIZING");
      await this._delay(600);
      if (isAborted()) return;
  
      this._setCurrentStep("DISCOVER_SERVICES");
      try { 
        await this.BluetoothLe.getServices({ deviceId }); 
      } catch (servErr) {
        console.warn("getServices warning:", servErr);
      }
      if (isAborted()) return;
      await this._delay(300);
  
      this._setCurrentStep("REQUEST_MTU");
      if (typeof this.BluetoothLe.requestMtu === 'function') {
        try {
          const mtuRes = await this.BluetoothLe.requestMtu({ deviceId, mtu: 247 });
          if (mtuRes?.mtu) this.currentMtu = mtuRes.mtu;
        } catch (mtuErr) {
          console.warn("requestMtu warning:", mtuErr);
        }
        if (isAborted()) return;
        await this._delay(300);
      }
  
      this._setCurrentStep("START_NOTIFICATIONS_EXEC");
      const notifOptions = {
        deviceId,
        service: this.serviceUuid,
        characteristic: this.txUuid
      };
      
      const onDataReceived = (result) => {
        if (currentSession === this.connectionSessionId) {
          this._parseData(result);
        }
      };

      if (this.valueListener) {
        try { await this.valueListener.remove(); } catch (e) {}
        this.valueListener = null;
      }
  
      try {
        const eventName = `notification|${deviceId}|${this.serviceUuid}|${this.txUuid}`;
        this.valueListener = await this.BluetoothLe.addListener(eventName, onDataReceived);
        await this.BluetoothLe.startNotifications(notifOptions);
      } catch (notifErr) {
        await this._delay(600);
        if (isAborted()) return;
        if (!this.valueListener) {
          const eventName = `notification|${deviceId}|${this.serviceUuid}|${this.txUuid}`;
          this.valueListener = await this.BluetoothLe.addListener(eventName, onDataReceived);
        }
        await this.BluetoothLe.startNotifications(notifOptions);
      }
  
      if (isAborted()) return;

      this._setCurrentStep("SUBSCRIBING_CCCD_WAIT");
      await this._delay(500);
      if (isAborted()) return;
  
      this._setCurrentStep("CONNECTED_WAITING_STABILITY");
      this.updateUI("connected");
  
      await this._safeSendHandshake();
      this._setCurrentStep("OPERATIONAL_PENDING_GUARD");
  
      this.stableTimer = setTimeout(() => {
        if (this.connectedDeviceId && !this.isConnecting && currentSession === this.connectionSessionId) {
          localStorage.removeItem("ble_crash_pending");
          this.autoConnectBlocked = false;
          this._setCurrentStep("STABLE_OPERATIONAL");
        }
      }, this.minStableSessionMs);
  
    } catch (err) {
      console.error("BLE connect error:", err);
      if (currentSession === this.connectionSessionId) {
        this.updateUI("disconnected");
      }
    } finally {
      if (currentSession === this.connectionSessionId) {
        this.isConnecting = false;
      }
    }
  }
  
  async _safeSendHandshake() {
    this._setCurrentStep("SEND_GET_SYS");
    try {
      await Promise.race([
        this.sendJson({ cmd: "get_sys" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Таймаут get_sys")), 3000))
      ]);
    } catch (cmdErr) {}
  }

  async disconnectBLE() {
    this.connectionSessionId++; 
    this.isExplicitDisconnect = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    
    localStorage.removeItem("ble_crash_pending");
    this.autoConnectBlocked = false;
    this._setCurrentStep("DISCONNECTING");

    if (this.valueListener) {
      try { await this.valueListener.remove(); } catch (e) {}
      this.valueListener = null;
    }

    if (this.connectedDeviceId && this.BluetoothLe) {
      try { 
        await this.BluetoothLe.stopNotifications({
          deviceId: this.connectedDeviceId,
          service: this.serviceUuid,
          characteristic: this.txUuid
        }).catch(() => {});
        await this.BluetoothLe.disconnect({ deviceId: this.connectedDeviceId }); 
      } catch (e) {}
    }
    this.connectedDeviceId = null;
    this.rxBuffer = "";
    this._setCurrentStep("IDLE");
    this.updateUI("disconnected");
  }

  scheduleReconnect(delayMs) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isExplicitDisconnect && this.connectedDeviceId && !this.autoConnectBlocked) {
        this.connectNativeBLE(this.connectedDeviceId);
      }
    }, delayMs);
  }

  _parseData(result) {
    if (this.isOtaInProgress || !result) return;

    const rawVal = result?.value !== undefined ? result.value : result;

    let bytes;
    try {
      if (rawVal instanceof Uint8Array) {
        bytes = rawVal;
      } else if (rawVal instanceof DataView) {
        bytes = new Uint8Array(rawVal.buffer, rawVal.byteOffset, rawVal.byteLength);
      } else if (rawVal && rawVal.buffer instanceof ArrayBuffer) {
        bytes = new Uint8Array(rawVal.buffer, rawVal.byteOffset || 0, rawVal.byteLength || rawVal.buffer.byteLength);
      } else if (typeof rawVal === 'string') {
        const cleanStr = rawVal.trim();
        // Проверка на шестнадцатеричную строку (Hex)
        if (/^[0-9a-fA-F\s]+$/.test(cleanStr) && cleanStr.replace(/\s+/g, '').length % 2 === 0) {
          const cleanHex = cleanStr.replace(/\s+/g, '');
          bytes = new Uint8Array(cleanHex.length / 2);
          for (let i = 0; i < cleanHex.length; i += 2) {
            bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
          }
        } else if (cleanStr.startsWith('{') || cleanStr.startsWith('[')) {
          bytes = new TextEncoder().encode(rawVal);
        } else {
          try {
            const binaryString = window.atob(cleanStr);
            bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          } catch (b64Err) {
            bytes = new TextEncoder().encode(rawVal);
          }
        }
      } else if (Array.isArray(rawVal)) {
        bytes = new Uint8Array(rawVal);
      } else if (typeof rawVal === 'object' && rawVal !== null) {
        bytes = new Uint8Array(Object.values(rawVal));
      } else {
        return;
      }
    } catch (err) {
      return;
    }

    let chunk = "";
    try {
      chunk = this.streamDecoder.decode(bytes, { stream: true });
    } catch (decErr) {
      this.streamDecoder = new TextDecoder('utf-8', { fatal: false });
      return;
    }

    this.rxBuffer += chunk;

    if (this.rxBuffer.length > this.maxBufferSize) {
      const lastNewline = this.rxBuffer.lastIndexOf('\n');
      this.rxBuffer = (lastNewline !== -1) ? this.rxBuffer.substring(lastNewline + 1) : "";
      return;
    }

    if (this.rxBuffer.includes('\n')) {
      const lines = this.rxBuffer.split('\n');
      this.rxBuffer = lines.pop();

      for (const line of lines) {
        this._processSingleLine(line);
      }
    } else {
      const trimmedBuf = this.rxBuffer.trim();
      if (trimmedBuf.startsWith('{') && trimmedBuf.endsWith('}')) {
        try {
          JSON.parse(trimmedBuf);
          this._processSingleLine(trimmedBuf);
          this.rxBuffer = "";
        } catch (e) {}
      }
    }
  }
  
  _processSingleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const telemetryData = JSON.parse(trimmed);

      if (typeof window.appendJsonLog === "function") {
        window.appendJsonLog("RX", trimmed);
      } else {
        this._log(`[RX JSON] ${trimmed}`);
      }

      if (telemetryData.version || telemetryData.fw || telemetryData.sys) {
        if (telemetryData.version) {
          this.espFwVersion = telemetryData.version;
        } else if (telemetryData.fw) {
          this.espFwVersion = telemetryData.fw;
        } else if (telemetryData.sys) {
          this.espFwVersion = typeof telemetryData.sys === 'object' 
            ? (telemetryData.sys.fw || telemetryData.sys.version || JSON.stringify(telemetryData.sys)) 
            : telemetryData.sys;
        }
        this.updateEspFwUI();
      }

      //this._setElementText('telemetryData', JSON.stringify(telemetryData, null, 2));

      this.onTelemetry(telemetryData);
    } catch (e) {
      this._log(`[Skip] Невалидный JSON: ${trimmed}`);
    }
  }
  
  async _writeRaw(deviceId, service, characteristic, uint8Bytes) {
    const uint8ToHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
    await this.BluetoothLe.write({ deviceId, service, characteristic, value: uint8ToHex(uint8Bytes) });
    return true;
  }  
  
  async _sendBytes(uint8Bytes, timeoutMs = 3000) {
    if (!this.connectedDeviceId || !this.BluetoothLe) throw new Error("Устройство не подключено");

    this._writeQueue = this._writeQueue.then(async () => {
      const writePromise = this._writeRaw(this.connectedDeviceId, this.serviceUuid, this.rxUuid, uint8Bytes);
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Таймаут отправки")), timeoutMs);
      });
      try {
        await Promise.race([writePromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }
    }).catch(err => { throw err; });

    return this._writeQueue;
  }
  
  async sendCmd(cmd) {
    if (!this.connectedDeviceId || !this.BluetoothLe) throw new Error("Устройство не подключено");

    if (typeof window.appendJsonLog === "function") {
      window.appendJsonLog("TX", cmd);
    }

    const bytes = new TextEncoder().encode(cmd);
    await this._sendBytes(bytes, 3000);
  }

  async sendJson(data) {
    let str = typeof data === "string" ? data : JSON.stringify(data);
    if (!str.endsWith('\n')) str += '\n';
    return await this.sendCmd(str);
  }

  async updateESP32Firmware(source = null) {
    if (!confirm("Начать прошивку ESP32 по BLE?")) return;
    const sessionAtStart = this.connectionSessionId;

    try {
      this.isOtaInProgress = true;
      this.updateUI("ota_start");

      let bytes;
      if (source instanceof Uint8Array) {
        bytes = source;
      } else if (source instanceof ArrayBuffer) {
        bytes = new Uint8Array(source);
      } else {
        const binUrl = typeof source === 'string' 
          ? source 
          : `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/firmware.bin`;

        const res = await fetch(binUrl);
        if (!res.ok) throw new Error(`Ошибка загрузки firmware.bin (${res.status})`);
        bytes = new Uint8Array(await res.arrayBuffer());
      }

      if (!this.isOtaInProgress || sessionAtStart !== this.connectionSessionId || !this.connectedDeviceId) {
        throw new Error("Соединение прервано");
      }

      await this.sendCmd(JSON.stringify({ cmd: "OTA_START", size: bytes.length }) + '\n');
      await this._delay(1000);

      const chunkSize = Math.min(244, Math.max(20, (this.currentMtu || 23) - 3));
      const total = bytes.length;

      for (let offset = 0; offset < total; offset += chunkSize) {
        if (!this.isOtaInProgress || sessionAtStart !== this.connectionSessionId || !this.connectedDeviceId) {
          throw new Error("Прошивка прервана");
        }
        await this._sendBytes(bytes.slice(offset, offset + chunkSize), 4000);
        await this._delay(15);

        const percent = Math.round((offset / total) * 100);
        if (offset % (chunkSize * 5) === 0 || offset + chunkSize >= total) {
          if (typeof this.onOtaProgressCallback === 'function') this.onOtaProgressCallback(percent);
          this._setElementText('bleStatus', `Прошивка ESP32: ${percent}%`);
        }
      }

      await this._delay(200);
      const fileCrc = this._calculateCRC32(bytes);
      await this.sendCmd(JSON.stringify({ cmd: "OTA_END", crc: fileCrc }) + '\n');
      
      alert("Прошивка успешно завершена! ESP32 перезагружается.");
      this.isOtaInProgress = false;
      this.disconnectBLE();
    } catch (e) {
      alert("Ошибка прошивки: " + e.message);
      this.isOtaInProgress = false;
      this.updateUI("connected");
    }
  }

  onTelemetry(data) {
    if (typeof this.onTelemetryCallback === 'function') {
      this.onTelemetryCallback(data);
    }
  }

  updateUI(state) {
    let textState = "Отключено";

    if (state === "connected") {
      textState = "Подключено";
      this._setElementClass('bleStatus', 'status connected');
      this._setElementStyle('bottomConnectBar', 'display', 'none');
      this._setElementStyle('btnDisconnect', 'display', 'block');
    } else if (state === "connecting" || state === "reconnecting" || state === "switching") {
      textState = state === "switching" ? "Поиск..." : (state === "connecting" ? "Подключение..." : "Поиск...");
      this._setElementClass('bleStatus', 'status pending spinner-active');
      this._setElementStyle('bottomConnectBar', 'display', 'none');
      this._setElementStyle('btnDisconnect', 'display', 'block');
    } else if (state === "ota_start") {
      textState = "Загрузка файла...";
    } else if (state === "crash_loop") {
      textState = "Заблокировано (Сбой)";
      this._setElementClass('bleStatus', 'status error');
      this._setElementStyle('bottomConnectBar', 'display', 'block');
      this._setElementStyle('btnDisconnect', 'display', 'none');
    } else {
      textState = "Отключено";
      this._setElementClass('bleStatus', 'status');
      this._setElementStyle('bottomConnectBar', 'display', 'block');
      this._setElementStyle('btnDisconnect', 'display', 'none');
      this._setElementText('telemetryData', '--');
    }

    this._setElementText('bleStatus', textState);
    this._setElementText('bleStatusInMenu', textState);

    if (typeof this.onStatusChangeCallback === 'function') {
      this.onStatusChangeCallback(state, textState);
    }
  }

  _setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  }

  _setElementClass(id, className) {
    const el = document.getElementById(id);
    if (el) el.className = className;
  }

  _setElementStyle(id, property, value) {
    const el = document.getElementById(id);
    if (el) el.style[property] = value;
  }
}
