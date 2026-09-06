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

    // Флаг проверки фактического получения системных разрешений Android
    this.hasPermissions = false;

    // Накопительный буфер и потоковый декодер
    this.rxBuffer = "";
    this.streamDecoder = new TextDecoder('utf-8');
    this.maxBufferSize = config.maxBufferSize || 16384; // Защитный лимит буфера (16 КБ)
    this.currentMtu = 23; // Стандартный дефолтный MTU

    this.valueListener = null;
    this.BluetoothLe = window.Capacitor?.Plugins?.BluetoothLe || (typeof Capacitor !== 'undefined' ? Capacitor.Plugins.BluetoothLe : null);

    console.log("[JE Core] Инициализирован экземпляр BaseBLEDevice", {
      repoOwner: this.repoOwner,
      repoName: this.repoName,
      appVersion: this.currentAppVersion
    });
  }

async init() {
    console.log("[JE Core] Запуск процесса инициализации (init)...");
    this.updateVersionUI();
    await this.loadAppVersion();

    if (this.BluetoothLe) {
      try {
        console.log("[JE Core] Инициализация и проверка разрешений Capacitor BluetoothLe...");
        
        try {
          await this.BluetoothLe.initialize();
        } catch (initErr) {
          console.warn("[JE Core] Предупреждение initialize:", initErr);
        }

        try {
          let needRequest = true;
          if (typeof this.BluetoothLe.checkPermissions === 'function') {
            const status = await this.BluetoothLe.checkPermissions();
            console.log("[JE Core] Статус разрешений:", status);
            if (status?.bluetoothConnect === 'granted' || status?.display === 'granted') {
              needRequest = false;
            }
          }

          if (needRequest) {
            await this.BluetoothLe.requestPermissions();
          }
          this.hasPermissions = true;
          console.log("[JE Core] Разрешения BLE подтверждены");
        } catch (permErr) {
          console.warn("[JE Core] Ошибка/предупреждение requestPermissions:", permErr);
          // Не блокируем флаг насмерть, так как на некоторых прошивках метод кидает ошибку, если права уже даны
          this.hasPermissions = true; 
        }

        await new Promise(r => setTimeout(r, 500));

        try {
          await this.BluetoothLe.addListener('disconnected', (info) => {
            console.warn("[JE Core] [Событие] Связь с устройством потеряна:", info);
            if (!this.isExplicitDisconnect && this.connectedDeviceId) {
              console.log("[JE Core] Непредвиденный разрыв. Запуск авто-переподключения...");
              this.updateUI("reconnecting");
              this.scheduleReconnect(1000);
            } else {
              console.log("[JE Core] Ручное или ожидаемое отключение. Реконнект отменен.");
              this.updateUI("disconnected");
            }
          });
          console.log("[JE Core] Слушатель события 'disconnected' зарегистрирован");
        } catch (err) {
          console.log("[JE Core] Слушатель отключения уже был зарегистрирован ранее");
        }

        const savedName = localStorage.getItem("savedDeviceName");
        if (savedName) {
          console.log(`[JE Core] Найдено сохраненное имя устройства: ${savedName}`);
          const el = document.getElementById('deviceName');
          if (el) el.innerText = savedName;
        }

        const savedId = localStorage.getItem("savedDeviceId");
        if (savedId) {
          console.log(`[JE Core] Найдено сохраненное ID устройства: ${savedId}. Запуск автоподключения...`);
          this.connectedDeviceId = savedId;
          this.isExplicitDisconnect = false;
          this.connectNativeBLE(savedId);
        } else {
          console.log("[JE Core] Сохраненные устройства не найдены");
        }
      } catch (e) {
        console.error("[JE Core] Ошибка инициализации BLE плагина:", e);
        const savedId = localStorage.getItem("savedDeviceId");
        if (savedId) {
          console.log(`[JE Core] Попытка запланировать повторный реконнект к ${savedId} через 2с...`);
          this.connectedDeviceId = savedId;
          this.isExplicitDisconnect = false;
          this.scheduleReconnect(2000);
        }
      }
    } else {
      console.warn("[JE Core] Плагин Capacitor BluetoothLe не обнаружен в системе!");
    }

    setTimeout(() => this.checkForUpdates(), 3000);
  }
  async loadAppVersion() {
    try {
      console.log("[JE Core] Чтение локального package.json...");
      const res = await fetch('./package.json');
      if (res.ok) {
        const pkg = await res.json();
        if (pkg.version) {
          this.currentAppVersion = pkg.version;
          console.log(`[JE Core] Версия приложения из package.json: v${this.currentAppVersion}`);
          this.updateVersionUI();
        }
      } else {
        console.warn(`[JE Core] Не удалось загрузить package.json. Статус: ${res.status}`);
      }
    } catch (e) {
      console.warn("[JE Core] Ошибка считывания package.json:", e);
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
    const url = `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/main/package.json`;
    console.log(`[JE Core] Проверка обновлений на GitHub: ${url}`);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[JE Core] Ошибка запроса обновлений. Код: ${res.status}`);
        return;
      }
      const pkg = await res.json();
      const remoteVersion = pkg.version;

      if (!remoteVersion) return;
      this.latestRemoteVersion = remoteVersion;
      console.log(`[JE Core] Удаленная версия на GitHub: v${remoteVersion} (Текущая App: v${this.currentAppVersion}, ESP FW: v${this.espFwVersion})`);

      let hasUpdate = false;

      if (this.isNewerVersion(remoteVersion, this.currentAppVersion)) {
        hasUpdate = true;
        console.log(`[JE Core] Доступно обновление приложения -> v${remoteVersion}`);
        const textEl = document.getElementById('updateNoticeText');
        const btnApp = document.getElementById('btnUpdateApp');
        const noticeEl = document.getElementById('updateNotice');
        if (textEl) textEl.innerText = `Доступна новая версия приложения v${remoteVersion}!`;
        if (btnApp) btnApp.style.display = 'inline-block';
        if (noticeEl) noticeEl.style.display = 'block';
      }

      if (this.espFwVersion && this.isNewerVersion(remoteVersion, this.espFwVersion)) {
        hasUpdate = true;
        console.log(`[JE Core] Доступно обновление прошивки ESP32 -> v${remoteVersion}`);
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
      } else {
        console.log("[JE Core] Установлены актуальные версии ПО и прошивки");
      }
    } catch (e) {
      console.error("[JE Core] Ошибка при проверке обновлений:", e);
    }
  }

  updateApp() {
    const apkUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/app-debug.apk`;
    console.log(`[JE Core] Переход к скачиванию APK: ${apkUrl}`);
    window.open(apkUrl, '_system');
  }

  async connectOrReconnect() {
    console.log("[JE Core] Ручной запуск подключения/переподключения");
    this.isExplicitDisconnect = false;
    clearTimeout(this.reconnectTimer);
    if (this.connectedDeviceId) this.connectNativeBLE(this.connectedDeviceId);
    else this.selectNewDevice();
  }

  async selectNewDevice() {
    if (!this.hasPermissions) {
      console.warn("[JE Core] Отмена выбора устройства: отсутствуют разрешения BLE!");
      this.updateUI("disconnected");
      return;
    }
    console.log("[JE Core] Открытие системного окна выбора BLE устройства...");
    try {
      this.isExplicitDisconnect = true;
      clearTimeout(this.reconnectTimer);
      this.updateUI("connecting");

      const result = await this.BluetoothLe.requestDevice({
        displayUnconnected: true
      });

      if (result && result.deviceId) {
        const deviceName = result.name || result.deviceId;
        console.log(`[JE Core] Выбрано устройство: ${deviceName} (${result.deviceId})`);
        this.connectedDeviceId = result.deviceId;

        localStorage.setItem("savedDeviceId", result.deviceId);
        localStorage.setItem("savedDeviceName", deviceName);

        const devNameEl = document.getElementById('deviceName');
        if (devNameEl) devNameEl.innerText = deviceName;

        this.isExplicitDisconnect = false;
        this.connectNativeBLE(result.deviceId);
      } else {
        console.log("[JE Core] Устройство не было выбрано (отмена пользователя)");
        this.updateUI("disconnected");
      }
    } catch (e) {
      console.warn("[JE Core] Отмена или ошибка при выборе устройства:", e);
      this.updateUI("disconnected");
    }
  }

  async connectNativeBLE(deviceId) {
    if (!this.hasPermissions) {
      console.warn("[JE Core] Блокировка подключения: отсутствуют разрешения Android BLUETOOTH_CONNECT!");
      this.updateUI("disconnected");
      return;
    }

    if (!deviceId) {
      console.warn("[JE Core] Не указан deviceId для подключения");
      return;
    }

    try {
      clearTimeout(this.reconnectTimer);
      console.log(`[JE Core] Соединение с BLE устройством ${deviceId}...`);
      this.updateUI("connecting");

      this.rxBuffer = "";
      this.streamDecoder = new TextDecoder('utf-8');
      this.currentMtu = 23;
      console.log("[JE Core] RX буфер и декодер сброшены");

      await this.BluetoothLe.connect({ deviceId });
      console.log(`[JE Core] Физическое BLE соединение с ${deviceId} установлено!`);

      try {
        console.log("[JE Core] Запрос на увеличение MTU до 247...");
        const mtuRes = await this.BluetoothLe.requestMtu({ deviceId, mtu: 247 });
        if (mtuRes && mtuRes.mtu) {
          this.currentMtu = mtuRes.mtu;
          console.log(`[JE Core] Успешно согласован MTU: ${this.currentMtu} байт`);
        }
      } catch (e) {
        console.warn("[JE Core] Согласование MTU не поддержано или отклонено (остается дефолтный MTU=23):", e);
      }

      await new Promise(r => setTimeout(r, 300));

      if (!this.valueListener) {
        console.log("[JE Core] Регистрация глобального слушателя 'characteristicValueReceived'...");
        this.valueListener = await this.BluetoothLe.addListener(
          'characteristicValueReceived',
          (result) => this._parseData(result)
        );
      }

      try {
        console.log(`[JE Core] Остановка предыдущих подписок TX (${this.txUuid})...`);
        await this.BluetoothLe.stopNotifications({
          deviceId,
          service: this.serviceUuid,
          characteristic: this.txUuid
        });
      } catch (e) {}

      console.log(`[JE Core] Подписка на уведомления (Notifications) TX (${this.txUuid})...`);
      await this.BluetoothLe.startNotifications({
        deviceId,
        service: this.serviceUuid,
        characteristic: this.txUuid
      });
      console.log("[JE Core] Подписка на TX успешно активирована");

      this.updateUI("connected");

      await new Promise(r => setTimeout(r, 600));
      console.log("[JE Core] Отправка стартового системного запроса: { cmd: 'get_sys' }");
      await this.sendCmd(JSON.stringify({ cmd: "get_sys" }));

    } catch (err) {
      console.error(`[JE Core] Ошибка подключения к устройству ${deviceId}:`, err);
      if (!this.isExplicitDisconnect) {
        this.updateUI("reconnecting");
        this.scheduleReconnect(3000);
      } else {
        this.updateUI("disconnected");
      }
    }
  }

  async disconnectBLE() {
    console.log("[JE Core] Инициировано явное отключение BLE пользователем/системой...");
    this.isExplicitDisconnect = true;
    clearTimeout(this.reconnectTimer);
    if (this.connectedDeviceId) {
      try { 
        console.log(`[JE Core] Отписка от уведомления TX (${this.txUuid})...`);
        await this.BluetoothLe.stopNotifications({
          deviceId: this.connectedDeviceId,
          service: this.serviceUuid,
          characteristic: this.txUuid
        });
        console.log(`[JE Core] Вызов disconnect для ${this.connectedDeviceId}...`);
        await this.BluetoothLe.disconnect({ deviceId: this.connectedDeviceId }); 
      } catch (e) {
        console.warn("[JE Core] Ошибка при процедуре отключения:", e);
      }
    }
    this.rxBuffer = "";
    this.updateUI("disconnected");
    console.log("[JE Core] Отключение завершено, RX буфер очищен");
  }

  scheduleReconnect(delayMs) {
    clearTimeout(this.reconnectTimer);
    console.log(`[JE Core] Запланирован повторный реконнект через ${delayMs} мс`);
    this.reconnectTimer = setTimeout(() => {
      if (!this.hasPermissions) {
        console.warn("[JE Core] Отмена реконнекта: отсутствуют разрешения BLE!");
        this.updateUI("disconnected");
        return;
      }
      if (!this.isExplicitDisconnect && this.connectedDeviceId) {
        console.log(`[JE Core] Выполнение запланированного реконнекта к ${this.connectedDeviceId}...`);
        this.connectNativeBLE(this.connectedDeviceId);
      } else {
        console.log("[JE Core] Запланированный реконнект отменен (явное отключение или нет ID)");
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
          const binaryString = atob(rawVal);
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
        console.warn("[JE Core] Неизвестный формат сырых входящих данных:", rawVal);
        return;
      }

      const chunkStr = this.streamDecoder.decode(bytes, { stream: true });
      this.rxBuffer += chunkStr;

      console.log(`[JE Core] [RX Chunk] Получено ${bytes.length} байт -> "${chunkStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}" | Буфер (${this.rxBuffer.length}/${this.maxBufferSize})`);

      if (this.rxBuffer.length > this.maxBufferSize) {
        console.warn(`[JE Core] Превышен защитный лимит буфера (${this.maxBufferSize} симв.), сброс накопленных данных!`);
        this.rxBuffer = "";
        return;
      }

      let idx;
      while ((idx = this.rxBuffer.indexOf('\n')) !== -1) {
        const line = this.rxBuffer.substring(0, idx).trim();
        this.rxBuffer = this.rxBuffer.substring(idx + 1);
        if (!line) continue;

        console.log(`[JE Core] [RX Line Extracted] "${line}"`);

        try {
          const data = JSON.parse(line);
          console.log("[JE Core] [JSON Parsed] Успешно распарсен пакет:", data);

          if (data.sys) {
            this.espFwVersion = typeof data.sys === 'object' ? data.sys.fw : data.sys;
            console.log(`[JE Core] Получена версия прошивки ESP32: v${this.espFwVersion}`);
            this.updateVersionUI();
          }

          if (typeof this.onTelemetry === 'function') {
            this.onTelemetry(data);
          }

        } catch (e) {
          console.warn("[JE Core] Ошибка парсинга JSON строки:", line, "Причина:", e.message);
        }
      }
    } catch (e) {
      console.error("[JE Core] Критическая ошибка в _parseData:", e);
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

    const numberArrayVal = Array.from(uint8Bytes);
    const dataViewVal = new DataView(uint8Bytes.buffer, uint8Bytes.byteOffset, uint8Bytes.byteLength);

    const variants = [
      { name: "Base64 string", value: base64Val },
      { name: "Numbers array", value: numberArrayVal },
      { name: "DataView", value: dataViewVal }
    ];

    let lastErr = null;
    for (const v of variants) {
      if (!v.value) continue;
      try {
        const opts = {
          deviceId: this.connectedDeviceId,
          service: this.serviceUuid,
          characteristic: this.rxUuid,
          value: v.value
        };
        await this._writeRaw(opts);
        console.log(`[JE Core] [TX Success] Успешно передано через формат: ${v.name}`);
        return;
      } catch (err) {
        lastErr = err;
        console.warn(`[JE Core] [TX Variant Failed] Формат ${v.name} не принят плагином:`, err);
      }
    }

    throw lastErr || new Error("Все форматы отправки были отклонены плагином");
  }

  async sendCmd(cmd) {
    if (!this.connectedDeviceId || !this.BluetoothLe) {
      console.warn("[JE Core] Отправка отклонена: нет подключения или не инициализирован BLE плагин");
      return;
    }
    try {
      const formattedCmd = cmd.endsWith('\n') ? cmd : cmd + '\n';
      const bytes = new TextEncoder().encode(formattedCmd);

      console.log(`[JE Core] [TX Command] Отправка ${bytes.length} байт в RX (${this.rxUuid}): "${formattedCmd.trim()}"`);
      await this._sendBytes(bytes);

    } catch (e) {
      console.error("[JE Core] [TX Error] Ошибка отправки команды:", e);
    }
  }

  async updateESP32Firmware() {
    if (!confirm(`Начать прошивку ESP32 до версии v${this.latestRemoteVersion}? Не отключайте устройство!`)) return;

    try {
      this.isOtaInProgress = true;
      console.log(`[JE Core] [OTA] Старт процедуры OTA. Целевая версия: v${this.latestRemoteVersion}`);
      const statusEl = document.getElementById('bleStatus');
      if (statusEl) statusEl.innerText = "Загрузка файла...";

      const binUrl = `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/latest/firmware.bin`;
      console.log(`[JE Core] [OTA] Скачивание файла бинарника: ${binUrl}`);
      const res = await fetch(binUrl);
      if (!res.ok) throw new Error(`Не удалось скачать firmware.bin с GitHub (Код: ${res.status})`);

      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      console.log(`[JE Core] [OTA] Бинарник загружен, размер: ${bytes.length} байт`);

      console.log("[JE Core] [OTA] Отправка команды OTA_START...");
      await this.sendCmd(JSON.stringify({ cmd: "OTA_START", size: bytes.length }));
      await new Promise(r => setTimeout(r, 1000));

      const chunkSize = Math.min(244, Math.max(20, (this.currentMtu || 23) - 3));
      const total = bytes.length;
      console.log(`[JE Core] [OTA] Начинаем передачу пакетов. Размер чанка: ${chunkSize} байт (MTU ${this.currentMtu})`);

      let lastLoggedPercent = -1;

      for (let offset = 0; offset < total; offset += chunkSize) {
        const chunk = bytes.slice(offset, offset + chunkSize);

        await this._sendBytes(chunk);

        let percent = Math.round((offset / total) * 100);
        if (percent % 10 === 0 && percent !== lastLoggedPercent) {
          console.log(`[JE Core] [OTA Progress] Передано: ${offset}/${total} байт (${percent}%)`);
          lastLoggedPercent = percent;
        }

        if (statusEl) statusEl.innerText = `Прошивка ESP32: ${percent}%`;
      }

      console.log("[JE Core] [OTA] Все чанки переданы. Отправка команды OTA_END...");
      await this.sendCmd(JSON.stringify({ cmd: "OTA_END" }));
      console.log("[JE Core] [OTA] Прошивка успешно передана. Устройство перезагружается.");
      alert("Прошивка успешно завершена! ESP32 перезагружается.");
      this.isOtaInProgress = false;
      this.disconnectBLE();

    } catch (e) {
      console.error("[JE Core] [OTA Error] Ошибка в процессе OTA:", e);
      alert("Ошибка прошивки: " + e.message);
      this.isOtaInProgress = false;
      this.updateUI("connected");
    }
  }

  onTelemetry(data) {}

  updateUI(state) {
    console.log(`[JE Core] [UI State] Переход состояния UI в: "${state}"`);
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
