class BaseBLEDevice {
  constructor(config = {}) {
    this.repoOwner = config.repoOwner || "johneagle200-ship-it";
    this.repoName = config.repoName || "je-ble-template";
    
    this.serviceUuid = (config.serviceUuid || "6e400001-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
    this.rxUuid = (config.rxUuid || "6e400002-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
    this.txUuid = (config.txUuid || "6e400003-b5a3-f393-e0a9-e50e24dcca9e").toLowerCase();
    this.namePrefix = config.namePrefix || "JE_";

    this.autoConnect = config.autoConnect !== undefined ? config.autoConnect : true;
    this.autoConnectBlocked = false;
    this.espFwVersion = null;

    this.connectedDeviceId = null;
    this.isConnecting = false;
    this.isExplicitDisconnect = false;
    this.reconnectTimer = null;
    this.isOtaInProgress = false;

    // --- CRASH GUARD (Энергонезависимая защита) ---
    this.minStableSessionMs = config.minStableSessionMs || 5000;
    this.stableTimer = null;
    this.currentStep = "IDLE";

    this.hasPermissions = false;

    this.rxBuffer = "";
    this.streamDecoder = new TextDecoder('utf-8');
    this.maxBufferSize = config.maxBufferSize || 16384;
    this.currentMtu = 23;

    this.preferredWriteFormat = null; 

    this.valueListener = null;
    this.disconnectListener = null;
    this.BluetoothLe = window.Capacitor?.Plugins?.BluetoothLe || (typeof Capacitor !== 'undefined' ? Capacitor.Plugins.BluetoothLe : null);

    this.onTelemetryCallback = config.onTelemetry || null;
    this.onStatusChangeCallback = config.onStatusChange || null;
    this.onOtaProgressCallback = config.onOtaProgress || null;

    this._log("[JE Core] Модуль BaseBLEDevice инициализирован.");
  }

  // --- ДИАГНОСТИКА И ЛОГИРОВАНИЕ ---
  _log(msg, level = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] [${level.toUpperCase()}] ${msg}`;
    
    if (level === "error") console.error(formatted);
    else if (level === "warn") console.warn(formatted);
    else console.log(formatted);

    try {
      const logs = JSON.parse(localStorage.getItem("ble_debug_logs") || "[]");
      logs.push(formatted);
      if (logs.length > 100) logs.shift(); // Храним последние 100 записей
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

  printDebugLogs() {
    const logs = this.getDebugLogs();
    console.log("=== BLE DEBUG LOGS ===");
    console.log(logs.join("\n"));
    return logs.join("\n");
  }

  _setCurrentStep(stepName) {
    this.currentStep = stepName;
    localStorage.setItem("ble_last_step", stepName);
    this._log(`[STEP] -> ${stepName}`);
  }

  resetCrashLock() {
    localStorage.removeItem("ble_crash_pending");
    this.autoConnectBlocked = false;
    this._log("[Crash Guard] Блокировка сбоя сброшена вручную.");
  }

  // --- ИНИЦИАЛИЗАЦИЯ С ПРОВЕРКОЙ СБОЯ ---
  async init() {
    this._log("[JE Core] Запуск процесса инициализации BLE...");

    // ПРОВЕРКА: Если прошлый запуск завершился нативным крашем до истечения 5 секунд работы
    const crashPending = localStorage.getItem("ble_crash_pending");
    const lastStep = localStorage.getItem("ble_last_step") || "UNKNOWN";

    if (crashPending === "1") {
      this.autoConnectBlocked = true;
      this._log(`[CRITICAL] Обнаружен нативный сбой при прошлом запуске!`, "error");
      this._log(`[CRITICAL] Сбой произошел на шаге: [${lastStep}]`, "error");
      this._log("[Crash Guard] Автоподключение ЗАБЛОКИРОВАНО. Проверь логи методом .printDebugLogs()", "warn");
    }

    if (!this.BluetoothLe) {
      this._log("[JE Core] Плагин Capacitor BluetoothLe не обнаружен!", "warn");
      return;
    }

    try {
      try {
        await this.BluetoothLe.initialize();
      } catch (initErr) {
        this._log(`[JE Core] Предупреждение инициализации BLE: ${initErr?.message || initErr}`, "warn");
      }

      await this.ensurePermissions();

      if (!this.disconnectListener) {
        try {
          this.disconnectListener = await this.BluetoothLe.addListener('disconnected', (info) => {
            this._log(`[Событие] Потеря связи на шаге [${this.currentStep}]: ${JSON.stringify(info)}`, "warn");
            this.isConnecting = false;
            clearTimeout(this.stableTimer);

            if (!this.isExplicitDisconnect && this.connectedDeviceId && !this.autoConnectBlocked) {
              this._log("[JE Core] Планирование повторного подключения...");
              this.updateUI("reconnecting");
              this.scheduleReconnect(3000);
            } else {
              this.updateUI("disconnected");
            }
          });
        } catch (err) {
          this._log(`Ошибка регистрации слушателя отключения: ${err?.message || err}`, "warn");
        }
      }

      const savedName = localStorage.getItem("savedDeviceName");
      if (savedName) {
        this._setElementText('deviceName', savedName);
      }

      // АВТОПОДКЛЮЧЕНИЕ
      if (this.autoConnect && !this.autoConnectBlocked) {
        const savedId = localStorage.getItem("savedDeviceId");
        if (savedId) {
          this._log(`Найдено сохраненное ID: ${savedId}. Запуск автоподключения...`);
          this.connectedDeviceId = savedId;
          this.isExplicitDisconnect = false;
          this.connectNativeBLE(savedId);
        }
      } else if (this.autoConnectBlocked) {
        this.updateUI("crash_loop");
      }
    } catch (e) {
      this._log(`Ошибка при инициализации BLE: ${e?.message || e}`, "error");
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
      this._log(`Предупреждение запроса разрешений: ${permErr?.message || permErr}`, "warn");
      this.hasPermissions = true;
    }
  }

  updateEspFwUI() {
    const versionStr = `v${this.espFwVersion || '---'}`;
    this._setElementText('espFwVersion', versionStr);
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

    try {
      this.resetCrashLock();
      this.isConnecting = true;
      this.isExplicitDisconnect = true;
      clearTimeout(this.reconnectTimer);
      this.updateUI("connecting");

      let result = null;
      try {
        result = await this.BluetoothLe.requestDevice({ 
          displayUnconnected: true,
          services: [this.serviceUuid],
          namePrefix: this.namePrefix,
          optionalServices: [this.serviceUuid]
        });
      } catch (nativeEx) {
        this._log(`Нативный сбой при сканировании: ${nativeEx?.message || nativeEx}`, "error");
        alert("Не удалось запустить поиск BLE. Проверьте разрешения геолокации и Bluetooth.");
        this.isConnecting = false;
        this.updateUI("disconnected");
        return;
      }

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
      this._log(`Отмена выбора устройства: ${e?.message || e}`, "warn");
      this.isConnecting = false;
      this.updateUI("disconnected");
    }
  }
  
  // --- ПОДКЛЮЧЕНИЕ С ПЕССИМИСТИЧНОЙ УСТАНОВКОЙ ФЛАГА ---
  async connectNativeBLE(deviceId) {
    if (this.isConnecting || !deviceId) return;

    await this.ensurePermissions();

    try {
      this.isConnecting = true;
      clearTimeout(this.reconnectTimer);
      clearTimeout(this.stableTimer);

      // ВЗВОДИМ ФЛАГ ПАДЕНИЯ ДО НАЧАЛА ОПЕРАЦИЙ
      localStorage.setItem("ble_crash_pending", "1");

      this.updateUI("connecting");
      this.rxBuffer = "";
      this.streamDecoder = new TextDecoder('utf-8');
      this.currentMtu = 23;

      // 1. GATT
      this._setCurrentStep("GATT_CONNECTING");
      await this.BluetoothLe.connect({ deviceId, timeout: 10000 });

      this._setCurrentStep("GATT_STABILIZING");
      await new Promise(r => setTimeout(r, 500));

      // 2. MTU
      this._setCurrentStep("MTU_REQUEST");
      try {
        const mtuRes = await this.BluetoothLe.requestMtu({ deviceId, mtu: 247 });
        if (mtuRes && mtuRes.mtu) {
          this.currentMtu = mtuRes.mtu;
          this._log(`Установлен MTU: ${this.currentMtu}`);
        }
      } catch (mtuErr) {
        this._log(`MTU отклонен (используем 23): ${mtuErr?.message || mtuErr}`, "warn");
      }

      await new Promise(r => setTimeout(r, 200));

      // 3. LISTENERS & NOTIFICATIONS
      this._setCurrentStep("REGISTER_LISTENER");
      if (!this.valueListener) {
        this.valueListener = await this.BluetoothLe.addListener(
          'characteristicValueReceived',
          (result) => this._parseData(result)
        );
      }

      this._setCurrentStep("START_NOTIFICATIONS");
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
        this._log(`Не удалось активировать TX notifications: ${notifErr?.message || notifErr}`, "error");
        throw notifErr;
      }

      this._setCurrentStep("CONNECTED_WAITING_STABILITY");
      this.updateUI("connected");

      // 4. СТАРТОВАЯ КОМАНДА
      await new Promise(r => setTimeout(r, 400));
      this._setCurrentStep("SEND_GET_SYS");
      await this.sendCmd(JSON.stringify({ cmd: "get_sys" }));

      this._setCurrentStep("OPERATIONAL_PENDING_GUARD");

      // СНИМАЕМ ФЛАГ ТОЛЬКО ЕСЛИ СЕССИЯ ПРОДЕРЖАЛАСЬ > 5 СЕКУНД БЕЗ НАТИВНОГО КРАША
      this.stableTimer = setTimeout(() => {
        if (this.connectedDeviceId && !this.isConnecting) {
          this._log("[Crash Guard] Сессия стабильна (>5с). Флаг аварийного падения снят.");
          localStorage.removeItem("ble_crash_pending");
          this.autoConnectBlocked = false;
          this._setCurrentStep("STABLE_OPERATIONAL");
        }
      }, this.minStableSessionMs);

    } catch (err) {
      this._log(`Ошибка на шаге [${this.currentStep}]: ${err?.message || err}`, "error");
      this.updateUI("disconnected");
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnectBLE() {
    this.isExplicitDisconnect = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    
    // Ручное отключение не является крашем — снимаем флаг
    localStorage.removeItem("ble_crash_pending");
    this.autoConnectBlocked = false;

    this._setCurrentStep("DISCONNECTING");
    if (this.connectedDeviceId && this.BluetoothLe) {
      try { 
        await this.BluetoothLe.stopNotifications({
          deviceId: this.connectedDeviceId,
          service: this.serviceUuid,
          characteristic: this.txUuid
        }).catch(() => {});
        
        await this.BluetoothLe.disconnect({ deviceId: this.connectedDeviceId }); 
      } catch (e) {
        this._log(`Ошибка при отключении: ${e?.message || e}`, "warn");
      }
    }
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
        this._log("Буфер переполнен, сброс!", "warn");
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

          this.onTelemetry(data);
        } catch (e) {
          this._log(`Ошибка парсинга JSON: ${line}`, "warn");
        }
      }
    } catch (e) {
      this._log(`Ошибка в _parseData: ${e?.message || e}`, "error");
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
        const len = uint8Bytes.byteLength;
        for (let i = 0; i < len; i++) {
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
      this._log(`Ошибка отправки команды: ${e?.message || e}`, "error");
    }
  }

  async updateESP32Firmware(source = null) {
    if (!confirm("Начать прошивку ESP32 по BLE?")) return;

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
        if (!res.ok) throw new Error(`Ошибка загрузки firmware.bin (Код: ${res.status})`);
        const arrayBuffer = await res.arrayBuffer();
        bytes = new Uint8Array(arrayBuffer);
      }

      await this.sendCmd(JSON.stringify({ cmd: "OTA_START", size: bytes.length }));
      await new Promise(r => setTimeout(r, 1000));

      const chunkSize = Math.min(244, Math.max(20, (this.currentMtu || 23) - 3));
      const total = bytes.length;

      for (let offset = 0; offset < total; offset += chunkSize) {
        const chunk = bytes.slice(offset, offset + chunkSize);
        await this._sendBytes(chunk);

        await new Promise(r => setTimeout(r, 10));

        const percent = Math.round((offset / total) * 100);
        if (offset % (chunkSize * 5) === 0) {
          if (typeof this.onOtaProgressCallback === 'function') {
            this.onOtaProgressCallback(percent);
          }
          const statusEl = document.getElementById('bleStatus');
          if (statusEl) statusEl.innerText = `Прошивка ESP32: ${percent}%`;
        }
      }

      await new Promise(r => setTimeout(r, 200));
      await this.sendCmd(JSON.stringify({ cmd: "OTA_END" }));
      
      alert("Прошивка успешно завершена! ESP32 перезагружается.");
      this.isOtaInProgress = false;
      this.disconnectBLE();

    } catch (e) {
      this._log(`Ошибка OTA: ${e?.message || e}`, "error");
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
    } else if (state === "connecting" || state === "reconnecting") {
      textState = state === "connecting" ? "Подключение..." : "Поиск...";
      this._setElementClass('bleStatus', 'status pending');
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
