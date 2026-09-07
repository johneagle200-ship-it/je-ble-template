# ARCHITECTURE.md — JE BLE Template (Unified Technical Blueprint)

Единый файл архитектуры системы. Содержит полную иерархическую структуру файлов, интерфейсов, функций, процедур и протоколов связи для сохранения контекста при редактировании отдельных модулей.

================================================================================

```text
.
├── index.html                                 # Единый UI приложения (Single Page Application)
│   ├── #app-header                            # Статус подключения, имя устройства, индикатор RSSI/MTU
│   ├── #telemetry-cards                       # Карточки отображения метрик (counter, uptime, status)
│   ├── #settings-drawer                       # Боковая шторка: управление BLE, OTA-прошивка, пресеты
│   ├── #crash-guard-modal                     # Модальное окно аварийного лога при падении нативного BLE
│   └── #eruda-debug-console                   # Встроенная мобильная консоль отладки и просмотра логов
│
├── app.js                                     # MainApp: Пользовательская бизнес-логика устройства
│   ├── class MainApp extends BaseApp          # Наследует оркестратор инфраструктуры
│   │   ├── constructor()                      # Привязка DOM-элементов и регистрация клик-хендлеров
│   │   ├── onTelemetry(data)                  # Callback: обработка входящего JSON и обновление карточек UI
│   │   ├── sendUserCommand(cmd, value)        # Формирование payload и вызов this.ble.sendCmd()
│   │   └── updateUIState(state)               # Переключение визуальных режимов (Online / Offline / OTA)
│   └── instance: const app = new MainApp()    # Точка входа в исполнение JS
│
├── BaseApp.js                                 # Оркестратор инфраструктуры и глобальный перехватчик
│   └── class BaseApp
│       ├── constructor()                      # Создание экземпляров BaseBLEDevice и AppUpdater
│       ├── initGlobalErrorHandling()          # Перехват window.onerror и window.onunhandledrejection
│       ├── setupLifecycleListeners()          # Обработка событий Capacitor App (pause, resume)
│       └── logToConsole(msg, level)           # Роутинг логов в UI-панель и ERUDA консоль
│
├── BaseBLEDevice.js                           # Ядро BLE-транспорта (Capacitor BluetoothLe)
│   ├── Constants & UUIDs
│   │   ├── SERVICE_UUID                       # "6e400001-b5a3-f393-e0a9-e50e24dcca9e" (NUS Service)
│   │   ├── RX_UUID                            # "6e400002-b5a3-f393-e0a9-e50e24dcca9e" (Write w/o resp)
│   │   └── TX_UUID                            # "6e400003-b5a3-f393-e0a9-e50e24dcca9e" (Notify)
│   │
│   ├── Crash Guard FSM (Защита от сбоев нативного BLE Android)
│   │   ├── checkCrashPending()                # Проверка флага "ble_crash_pending" при запуске
│   │   ├── setCrashPending(stage)             # Запись текущего шага GATT перед вызовом нативного API
│   │   ├── clearCrashPending()                # Сброс флага после minStableSessionMs (5000 мс) работы
│   │   └── showCrashReportModal()             # Вывод модалки с дампом этапа падения
│   │
│   ├── Sequential GATT Pipeline (Пошаговое рукопожатие без Race Conditions)
│   │   ├── connect(deviceId)                  # Этап 1: BluetoothLe.connect()
│   │   ├── discoverServices()                 # Этап 2: BluetoothLe.getServices()
│   │   ├── requestMtu(mtuSize)                # Этап 3: Согласование MTU (до 247 байт)
│   │   ├── startNotifications()               # Этап 4: Подписка на TX_UUID характеристику
│   │   └── sendHandshake()                    # Этап 5: Передача кадра {"cmd":"get_sys"}
│   │
│   ├── Stream Rx Decoder (Потоковый декодер пакетов)
│   │   ├── rxBuffer                           # Промежуточный байтовый массив (лимит 16384 B)
│   │   ├── handleDataReceived(data)           # Накопление байт и поиск разделителя '\n' (ASCII 10)
│   │   └── emitParsedJson(jsonStr)            # JSON.parse() и маркерный роутинг (telemetry/sys)
│   │
│   └── OTA Client Agent (Загрузчик прошивки)
│       ├── startOTA(binaryArrayBuffer)        # Отправка команды {"cmd":"OTA_START","size":N}
│       ├── sendOTAPackets()                   # Нарезка бинарника на чанки под MTU и отправка в RX
│       └── finishOTA(calculatedCrc32)         # Отправка команды {"cmd":"OTA_END","crc":X}
│
├── AppUpdater.js                              # Модуль автообновления APK через GitHub Releases
│   └── class AppUpdater
│       ├── checkUpdate()                      # Запрос package.json из ветки main через GitHub Raw API
│       ├── compareVersions(current, remote)   # Сравнение версий по стандарту SemVer
│       ├── showUpdateNotification()           # Активация UI-бейджа о наличии новой версии
│       └── getDownloadUrl()                   # Прямая ссылка на app-debug.apk из релиза 'latest'
│
├── package.json                               # Метаданные проекта, версия (SemVer) и npm-зависимости
├── capacitor.config.json                      # Конфигурация мобильного контейнера (appId, webDir)
│
├── .github/
│   └── workflows/
│       └── build-apk.yml                      # CI/CD автоматизация сборки Android
│           ├── Step 1: Environment Setup      # Развертывание Ubuntu, Node.js 20, Java JDK 17 (Zulu)
│           ├── Step 2: Keystore Restoring     # Декодирование DEBUG_KEYSTORE_BASE64 из секретов
│           ├── Step 3: Manifest Patching      # Python-скрипт: внедрение Bluetooth Scan/Connect (Android 12+)
│           └── Step 4: Gradle Assembly        # Сборка ./gradlew assembleDebug и обновление релиза 'latest'
│
├── esp32/
│   ├── main.ino                               # Главный скетч микроконтроллера
│   │   ├── Setup & Hardware Init
│   │   │   ├── setup()                        # Инициализация Serial, I2C Wire, U8g2 OLED и BLE Engine
│   │   │   └── displayInitScreen()            # Вывод стартового логотипа и состояния поиска BLE
│   │   │
│   │   ├── Main Loop Tasks
│   │   │   ├── loop()                         # Таймер 1 Гц для сбора системных метрик
│   │   │   ├── sendTelemetry()                # Формирование StaticJsonDocument и вызов ble.sendJson()
│   │   │   └── updateOLED()                   # Отрисовка статуса BLE, текущего MTU, счетчика и аптайма
│   │   │
│   │   └── Command Dispatcher
│   │       └── onRxCommand(JsonDocument& doc) # Разбор команд: "get_sys", "OTA_START" и кастомных UI команд
│   │
│   └── JE_BLE_Manager.h                       # C++ Ядро BLE (NimBLE Stack & OTA Engine)
│       ├── Constants & Config
│       │   ├── SERVICE_UUID / RX / TX         # UUIDs Nordic UART Service
│       │   ├── NOTIFY_DELAY_MS                # Пауза 10 мс между пакетами при нарезке JSON
│       │   └── MAX_RX_BUFFER                  # Размер приемного буфера с гарантией нуль-терминатора '\0'
│       │
│       └── class JE_BLE_Manager
│           ├── init(deviceName)               # Инициализация NimBLEServer, NUS и рекламных пакетов (Adv)
│           ├── sendJson(JsonDocument& doc)    # Сериализация JSON, нарезка под (peerMtu - 3) и отправка в TX
│           ├── handleOTAData(uint8_t* p, int) # Прямая запись сырых байт во флеш через Update.write()
│           ├── finishOTA(uint32_t expectedCrc)# Валидация размера/CRC32, Update.end() и ESP.restart()
│           └── ServerCallbacks                # Обработка событий подключения, отключения и согласования MTU
│
└── [REMARK_BLE_RELIABILITY_RULES]             # Памятка-ремарк: 6 Золотых правил надежности BLE транспорта
    ├── Rule 1: Event-Driven Execution         # Переход к след. шагу GATT строго по нативному событию/коллбэку, а не по таймеру
    ├── Rule 2: Guard Intervals (50-100 ms)    # Паузы между асинхронными вызовами для очистки Event Loop драйвера Android
    ├── Rule 3: Watchdog Safety Timeouts       # Жесткий таймаут (3-5 сек) на каждый вызов от зависания нативного стека
    ├── Rule 4: Retry with Backoff             # Повторы GATT ошибок (133/257): до 3 попыток (100ms -> 300ms -> 700ms)
    ├── Rule 5: Dynamic MTU Fallback           # Откат на дефолтные 23 байта при отказе MTU 247 без разрыва связи
    └── Rule 6: Crash Guard FSM                # Запись шага в localStorage перед нативным API для отслеживания вылетов
