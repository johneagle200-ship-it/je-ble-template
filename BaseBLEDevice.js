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
    this.isConnecting = false; // Флаг блокировки от параллельных вызовов подключения
    this.isExplicitDisconnect = false;
    this.reconnectTimer = null;
    this.isOtaInProgress = false;

    this.hasPermissions = false;

    this.rxBuffer = "";
    this.streamDecoder = new TextDecoder('utf-8');
    this.maxBufferSize = config.maxBufferSize || 16384;
    this.currentMtu = 23;

    this.valueListener = null;
    this.disconnectListener = null;
    this.BluetoothLe = window.Capacitor?.Plugins?.BluetoothLe || (typeof Capacitor !== 'undefined' ? Capacitor.Plugins.BluetoothLe : null);

    console.log("[JE Core] Инициализирован модуль BaseBLEDevice", {
      repoOwner: this.repoOwner,
      repoName: this.repoName,
      appVersion: this.currentAppVersion
    });
  }

  async init() {
    console.log("[JE Core] Запуск процесса инициализации (init)...");
    this.updateVersionUI();
    await this.loadAppVersion();

    if (!this.BluetoothLe) {
      console.warn("[JE Core] Плагин Capacitor BluetoothLe не обнаружен в системе!");
      return;
    }

    try {
      console.log("[JE Core] Инициализация плагина Capacitor BluetoothLe...");
      try {
        await this.BluetoothLe.initialize();
      } catch (initErr) {
        console.warn("[JE Core] Инициализация плагина уже выполнялась или выдала предупреждение:", initErr);
      }

      await this.ensurePermissions();

      // Подписка на глобальное событие отключения
      if (!this.disconnectListener) {
        try {
          this.disconnectListener = await this.BluetoothLe.addListener('disconnected', (info) => {
            console.warn("[JE Core] [Событие] Связь с устройством потеряна:", info);
            if (!this.isExplicitDisconnect && this.connectedDeviceId) {
              console.log("[JE Core] Непредвиденный разрыв. Запуск авто-переподключения...");
              this.updateUI("reconnecting");
              this.scheduleReconnect(1500);
            } else {
              console.log("[JE Core] Ручное или ожидаемое отключение.");
              this.updateUI("disconnected");
            }
          });
          console.log("[JE Core] Слушатель события 'disconnected' успешно зарегистрирован");
        } catch (err) {
          console.warn("[JE Core] Не удалось зарегистрировать слушатель отключения:", err);
        }
      }

      // Восстановление сохраненных данных
      const savedName = localStorage.getItem("savedDeviceName");
      if (savedName) {
        const el = document.getElementById('deviceName');
        if (el) el.innerText = savedName;
      }

      const savedId = localStorage.getItem("savedDeviceId");
      if (savedId) {
        console.log(`[JE Core] Найдено сохраненное ID устройства: ${savedId}. Запуск автоподключения...`);
        this.connectedDeviceId = savedId;
        this.isExplicitDisconnect = false;
        this.connectNativeBLE(savedId);
      }
    } catch (e) {
      console.error("[JE Core] Критическая ошибка при инициализации BLE плагина:", e);
    }

    setTimeout(() => this.checkForUpdates(), 3000);
  }

  // Безопасная проверка и запрос разрешений без падения приложения
async ensurePermissions() {
  try {
    if (typeof this.BluetoothLe.checkPermissions === 'function') {
      const status = await this.BluetoothLe.checkPermissions();
      console.log("[JE Core] Статус текущих разрешений:", status);

      const connectGranted = status?.bluetoothConnect === 'granted';
      const scanGranted = status?.bluetoothScan === 'granted';

      // Если основные права Android 12+ уже получены, не вызывать requestPermissions
      if (connectGranted && scanGranted) {
        console.log("[JE Core] Все нужные разрешения BLE уже предоставлены");
        this.hasPermissions = true;
        return;
      }
    }

    if (typeof this.BluetoothLe.requestPermissions === 'function') {
      await this.BluetoothLe.requestPermissions();
    }
    this.hasPermissions = true;
    console.log("[JE Core] Разрешения BLE успешно запрошены");
  } catch (permErr) {
    console.warn("[JE Core] Предупреждение/ошибка при запросе разрешений:", permErr);
    this.hasPermissions = true;
  }
}
  async loadAppVersion() {
    try {
      const res = await fetch('./package.json');
      if (res.ok) {
        const pkg = await res.json();
        if (pkg.version) {
          this.currentAppVersion = pkg.version;
          console.log(`[JE Core] Версия приложения из package.json: v${this.currentAppVersion}`);
          this.updateVersionUI();
        }
      }
    } catch (e) {
      console.warn("[JE Core] Не удалось прочитать package.json:", e);
      this.updateVersionUI();
    }
  }

  updateVersionUI() {
    const versionEl = document.getElementById('appVersion');
    if (versionEl) versionEl.innerText = `v${this.currentAppVersion}`;

    const espVerEl = document.getElementById('espFwVersion');
    if (espVerEl) espVerEl.innerText = `v${this.espFwVersion || this.currentAppVersion}`;

    const espTextEl = document.getElementById('espFwText');
    if (espTextEl) espTextEl.innerText = `v${this.espFwVersion || this.currentAppVersion}`;
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
    const url = `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/main/package.json`;
    try {
      const res = await fetch(url);
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
      console.error("[JE Core] Ошибка проверки обновлений:", e);
    }
  }

  updateApp() {
    const apkUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/app-debug.apk`;
    window.open(apkUrl, '_system');
  }

  async connectOrReconnect() {
    console.log("[JE Core] Ручной запуск подключения");
    this.isExplicitDisconnect = false;
    clearTimeout(this.reconnectTimer);
    if (this.connectedDeviceId) {
      this.connectNativeBLE(this.connectedDeviceId);
    } else {
      this.selectNewDevice();
    }
  }

  async selectNewDevice() {
    if (this.isConnecting) {
      console.warn("[JE Core] Процесс подключения уже запущен, вызов пропущен");
      return;
    }

    await this.ensurePermissions();

    try {
      this.isConnecting = true;
      this.isExplicitDisconnect = true;
      clearTimeout(this.reconnectTimer);
      this.updateUI("connecting");

      console.log("[JE Core] Открытие диалога выбора устройства...");
      const result = await this.BluetoothLe.requestDevice({ displayUnconnected: true });

      if (result && result.deviceId) {
        const deviceName = result.name || result.deviceId;
        console.log(`[JE Core] Выбрано устройство: ${deviceName} (${result.deviceId})`);
        this.connectedDeviceId = result.deviceId;

        localStorage.setItem("savedDeviceId", result.deviceId);
        localStorage.setItem("savedDeviceName", deviceName);

        const devNameEl = document.getElementById('deviceName');
        if (devNameEl) devNameEl.innerText = deviceName;

        this.isExplicitDisconnect = false;
        
        // Освобождаем блокировку перед вызовом основного подключения
        this.isConnecting = false; 
        this.connectNativeBLE(result.deviceId);
      } else {
        console.log("[JE Core] Устройство не выбранопользователем");
        this.isConnecting = false;
        this.updateUI("disconnected");
      }
    } catch (e) {
      console.warn("[JE Core] Ошибка/отмена выбора устройства:", e);
      this.isConnecting = false;
      this.updateUI("disconnected");
    }
  }

  async connectNativeBLE(deviceId) {
    if (this.isConnecting) {
      console.warn("[JE Core] Подключение уже выполняется. Повторный запрос заблокирован.");
      return;
    }

    if (!deviceId) {
      console.warn("[JE Core] Ошибка: deviceId не передан!");
      return;
    }

    await this.ensurePermissions();

    try {
      this.isConnecting = true;
      clearTimeout(this.reconnectTimer);
      console.log(`[JE Core] Соединение с BLE устройством ${deviceId}...`);
      this.updateUI("connecting");

      this.rxBuffer = "";
      this.streamDecoder = new TextDecoder('utf-8');
      this.currentMtu = 23;

      // 1. Подключение
      await this.BluetoothLe.connect({ deviceId, timeout: 10000 });
      console.log(`[JE Core] Физическое BLE соединение с ${deviceId} установлено`);

      // Пауза для стабилизации GATT-стека на Android
      await new Promise(r => setTimeout(r, 600));

      // 2. Безопасный запрос MTU (изолирован от ошибок)
      try {
        console.log("[JE Core] Запрос MTU 247...");
        const mtuRes = await this.BluetoothLe.requestMtu({ deviceId, mtu: 247 });
        if (mtuRes && mtuRes.mtu) {
          this.currentMtu = mtuRes.mtu;
          console.log(`[JE Core] Согласованный MTU: ${this.currentMtu}`);
        }
      } catch (mtuErr) {
        console.warn("[JE Core] Запрос MTU отклонен (используется базовый MTU=23):", mtuErr);
      }

      await new Promise(r => setTimeout(r, 300));

      // 3. Подписка на данные
      if (!this.valueListener) {
        this.valueListener = await this.BluetoothLe.addListener(
          'characteristicValueReceived',
          (result) => this._parseData(result)
        );
      }

      // 4. Безопасная настройка уведомлений TX
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
        console.log("[JE Core] Уведомления TX успешно активированы");
      } catch (notifErr) {
        console.error("[JE Core] Не удалось активировать TX notifications:", notifErr);
      }

      this.updateUI("connected");

      // 5. Запрос системной информации
      await new Promise(r => setTimeout(r, 500));
      await this.sendCmd(JSON.stringify({ cmd: "get_sys" }));

    } catch (err) {
      console.error(`[JE Core] Ошибка подключения к ${deviceId}:`, err);
      if (!this.isExplicitDisconnect) {
        this.updateUI("reconnecting");
        this.scheduleReconnect(4000);
      } else {
        this.updateUI("disconnected");
      }
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnectBLE() {
    console.log("[JE Core] Отключение BLE...");
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
    console.log(`[JE Core] Запланирован повторный реконнект через ${delayMs} мс`);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isExplicitDisconnect && this.connectedDeviceId) {
        console.log(`[JE Core] Выполнение реконнекта к ${this.connectedDeviceId}...`);
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

      const chunkStr = this.streamDecoder.decode(bytes, { stream: true });
      this.rxBuffer += chunkStr;

      if (this.rxBuffer.length > this.maxBufferSize) {
        console.warn("[JE Core] Превышен лимит буфера, сброс!");
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
            this.updateVersionUI();
          }

          if (typeof this.onTelemetry === 'function') {
            this.onTelemetry(data);
          }
        } catch (e) {
          console.warn("[JE Core] Ошибка парсинга JSON:", line, e.message);
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

    let base64Val = "";
    try {
      let binary = "";
      for (let i = 0; i < uint8Bytes.length; i++) {
        binary += String.fromCharCode(uint8Bytes[i]);
      }
      base64Val = window.btoa(binary);
    } catch (e) {}

    const variants = [
      { name: "Base64 string", value: base64Val },
      { name: "Numbers array", value: Array.from(uint8Bytes) },
      { name: "DataView", value: new DataView(uint8Bytes.buffer, uint8Bytes.byteOffset, uint8Bytes.byteLength) }
    ];

    let lastErr = null;
    for (const v of variants) {
      if (!v.value) continue;
      try {
        await this._writeRaw({
          deviceId: this.connectedDeviceId,
          service: this.serviceUuid,
          characteristic: this.rxUuid,
          value: v.value
        });
        return;
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error("Все форматы отправки отклонены плагином");
  }

  async sendCmd(cmd) {
    if (!this.connectedDeviceId || !this.BluetoothLe) {
      console.warn("[JE Core] Отправка отклонена: нет соединения");
      return;
    }
    try {
      const formattedCmd = cmd.endsWith('\n') ? cmd : cmd + '\n';
      const bytes = new TextEncoder().encode(formattedCmd);
      await this._sendBytes(bytes);
    } catch (e) {
      console.error("[JE Core] Ошибка отправки команды:", e);
    }
  }

  async updateESP32Firmware() {
    if (!confirm(`Начать прошивку ESP32 до версии v${this.latestRemoteVersion}?`)) return;

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

        const percent = Math.round((offset / total) * 100);
        if (statusEl) statusEl.innerText = `Прошивка ESP32: ${percent}%`;
      }

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
