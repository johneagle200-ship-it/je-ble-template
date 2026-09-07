```text
├── index.html               # Основной UI приложения (счётчики, меню, логгер, модальные окна)
├── app.js                   # MainApp: пользовательская логика приложения и обработка телеметрии
├── BaseApp.js               # BaseApp: оркестратор модулей (BLE + AppUpdater) и перехватчик JS-ошибок
├── BaseBLEDevice.js         # Ядро BLE (Capacitor BluetoothLe, Crash Guard FSM, OTA, логгер)
├── AppUpdater.js            # Модуль проверки обновлений APK через GitHub Releases
├── package.json             # Метаданные приложения и зависимости Capacitor
├── capacitor.config.json    # Конфигурация гибридного приложения Capacitor (Android/iOS)
├── .github/
│   └── workflows/
│       └── build-apk.yml    # CI/CD: автосборка Android APK при коммите в main/master
└── esp32/
    ├── main.ino             # Главный скетч: дисплей U8g2 (SSD1306), отправка телеметрии, обработка команд
    └── JE_BLE_Manager.h     # C++ ядро BLE на ESP32 (NimBLE-stack, OTA, JSON-сериализация, MTU)
