// Переменные версии и репозитория
let CURRENT_VERSION = "0.0.0"; // Загружается автоматически из package.json
const REPO_OWNER = "johneagle200-ship-it";
const REPO_NAME = "rectification-controller-apk";

// Безопасное получение BluetoothLe из Capacitor
const BluetoothLe = window.Capacitor?.Plugins?.BluetoothLe || (typeof Capacitor !== 'undefined' ? Capacitor.Plugins.BluetoothLe : null);

const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const CHARACTERISTIC_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const CHARACTERISTIC_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let connectedDeviceId = null;
let isExplicitDisconnect = false;
let reconnectTimer = null;

// ==========================================
// 1. ИНИЦИАЛИЗАЦИЯ И ДИНАМИЧЕСКАЯ ВЕРСИЯ
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Загружаем локальную версию из package.json
  await loadAppVersion();

  // 2. Инициализируем BLE
  try {
    if (!BluetoothLe) {
      console.error("[BLE Native] Плагин BluetoothLe не инициализирован");
      return;
    }

    await BluetoothLe.initialize();
    await BluetoothLe.requestPermissions();
    console.log("[BLE Native] Плагин готов");

    // Подгружаем имя устройства из памяти, если сохранено
    const savedName = localStorage.getItem("savedDeviceName");
    if (savedName) {
      document.getElementById('deviceName').innerText = savedName;
    }

    // Если устройство уже сохранялось — автоподключение
    const savedId = localStorage.getItem("savedDeviceId");
    if (savedId) {
      connectedDeviceId = savedId;
      console.log("[BLE Native] Автоподключение к:", savedId);
      connectNativeBLE(savedId);
    }
  } catch (err) {
    console.error("[BLE Native] Ошибка инициализации:", err);
  }

  // 3. Проверяем обновления на GitHub через 3 секунды
  setTimeout(checkForUpdates, 3000);
});

// Чтение версии из локального package.json
async function loadAppVersion() {
  try {
    const response = await fetch('./package.json');
    if (response.ok) {
      const pkg = await response.json();
      if (pkg.version) {
        CURRENT_VERSION = pkg.version;
        
        // Меняем отображаемый номер версии в интерфейсе (index.html)
        const versionEl = document.getElementById('appVersion');
        if (versionEl) {
          versionEl.innerText = `v${CURRENT_VERSION}`;
        }
        console.log(`[Version] Загружена локальная версия: v${CURRENT_VERSION}`);
      }
    }
  } catch (e) {
    console.log("[Version] Не удалось прочитать локальный package.json", e);
  }
}

// ==========================================
// 2. ПРОВЕРКА ОБНОВЛЕНИЙ C GITHUB
// ==========================================

// Корректное сравнение версий SemVer ("1.0.7" > "1.0.6")
function isNewerVersion(remote, current) {
  const r = remote.split('.').map(Number);
  const c = current.split('.').map(Number);
  
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const remoteNum = r[i] || 0;
    const currentNum = c[i] || 0;
    if (remoteNum > currentNum) return true;
    if (remoteNum < currentNum) return false;
  }
  return false;
}

async function checkForUpdates() {
  if (CURRENT_VERSION === "0.0.0") return;

  try {
    const response = await fetch(`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/package.json`);
    if (!response.ok) return;
    const remotePackage = await response.json();
    
    // Показываем окно ТОЛЬКО если версия на GitHub строго БОЛЬШЕ текущей
    if (remotePackage.version && isNewerVersion(remotePackage.version, CURRENT_VERSION)) {
      showUpdateModal(remotePackage.version);
    }
  } catch (err) {
    console.log("[UpdateCheck] Не удалось проверить обновления:", err);
  }
}

function showUpdateModal(newVersion) {
  const apkUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/latest/app-debug.apk`;
  
  if (confirm(`Доступна новая версия v${newVersion}! Скачать и установить?`)) {
    window.open(apkUrl, '_system');
  }
}

// ==========================================
// 3. РАБОТА С BLE (ПОИСК, ПОДКЛЮЧЕНИЕ, КОМАНДЫ)
// ==========================================

async function connectOrReconnect() {
  isExplicitDisconnect = false;
  clearTimeout(reconnectTimer);

  const savedId = localStorage.getItem("savedDeviceId");
  if (savedId) {
    connectNativeBLE(savedId);
  } else {
    selectNewDevice();
  }
}

// Поиск и выбор устройства по префиксу JE_
async function selectNewDevice() {
  try {
    isExplicitDisconnect = true;
    clearTimeout(reconnectTimer);

    updateUI("connecting");

    const device = await BluetoothLe.requestDevice({
      namePrefix: 'JE_'
    });

    if (device && device.deviceId) {
      connectedDeviceId = device.deviceId;
      const devName = device.name || "JE_Device";

      localStorage.setItem("savedDeviceId", connectedDeviceId);
      localStorage.setItem("savedDeviceName", devName);
      document.getElementById('deviceName').innerText = devName;

      isExplicitDisconnect = false;
      connectNativeBLE(connectedDeviceId);
    }
  } catch (err) {
    console.log("[BLE Native] Выбор устройства отменен:", err);
    updateUI("disconnected");
  }
}

async function connectNativeBLE(deviceId) {
  if (!deviceId) return;

  try {
    clearTimeout(reconnectTimer);
    updateUI("connecting");

    await BluetoothLe.connect({ deviceId });
    console.log("[BLE Native] Подключено к GATT!");

    await BluetoothLe.startNotifications({
      deviceId,
      service: SERVICE_UUID,
      characteristic: CHARACTERISTIC_TX_UUID
    }, (result) => {
      handleTelemetry(result);
    });

    updateUI("connected");

  } catch (err) {
    console.error("[BLE Native] Ошибка соединения:", err);

    if (!isExplicitDisconnect) {
      updateUI("reconnecting");
      scheduleReconnect(3000);
    } else {
      updateUI("disconnected");
    }
  }
}

async function disconnectBLE() {
  isExplicitDisconnect = true;
  clearTimeout(reconnectTimer);

  if (connectedDeviceId) {
    try {
      await BluetoothLe.disconnect({ deviceId: connectedDeviceId });
    } catch (e) {}
  }

  updateUI("disconnected");
}

function scheduleReconnect(delayMs) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!isExplicitDisconnect && connectedDeviceId) {
      connectNativeBLE(connectedDeviceId);
    }
  }, delayMs);
}

// ==========================================
// 4. ИНТЕРФЕЙС И ТЕЛЕМЕТРИЯ
// ==========================================

function updateUI(state) {
  const statusEl = document.getElementById('bleStatus');
  const btnConnect = document.getElementById('btnConnect');
  const btnDisconnect = document.getElementById('btnDisconnect');

  if (state === "connected") {
    statusEl.innerText = "Подключено";
    statusEl.className = "status connected";
    btnConnect.style.display = "none";
    btnDisconnect.style.display = "inline-block";
  } 
  else if (state === "connecting" || state === "reconnecting") {
    statusEl.innerText = state === "connecting" ? "Подключение..." : "Поиск устройства...";
    statusEl.className = "status pending";
    btnConnect.style.display = "none";
    btnDisconnect.style.display = "inline-block";
  }
  else {
    statusEl.innerText = "Отключено";
    statusEl.className = "status";
    btnConnect.style.display = "inline-block";
    btnConnect.innerText = connectedDeviceId ? "Подключить" : "Найти устройство";
    btnDisconnect.style.display = "none";
  }
}

function handleTelemetry(result) {
  try {
    const rawVal = result.value || result;
    let bytes;

    if (rawVal instanceof DataView) {
      bytes = new Uint8Array(rawVal.buffer);
    } else if (rawVal.buffer) {
      bytes = new Uint8Array(rawVal.buffer);
    } else if (Array.isArray(rawVal)) {
      bytes = new Uint8Array(rawVal);
    } else {
      bytes = new Uint8Array(rawVal);
    }

    const jsonStr = new TextDecoder().decode(bytes);
    const data = JSON.parse(jsonStr);

    if (data.t_c !== undefined) document.getElementById('tempCube').innerText = data.t_c + " °C";
    if (data.pwr !== undefined) document.getElementById('pwr').innerText = data.pwr + " Вт";
  } catch (e) {
    // Игнорируем неполные кадры
  }
}

async function sendCmd(cmd) {
  if (!connectedDeviceId) {
    alert("Устройство не подключено!");
    return;
  }
  try {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(cmd);
    const numbers = Array.from(encoded);

    await BluetoothLe.write({
      deviceId: connectedDeviceId,
      service: SERVICE_UUID,
      characteristic: CHARACTERISTIC_RX_UUID,
      value: numbers
    });
  } catch (e) {
    console.error("[BLE Native] Ошибка отправки:", e);
  }
}
