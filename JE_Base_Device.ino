#include <Arduino.h>
#include <U8g2lib.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define DEVICE_NAME "JE_BaseDevice"
#define FW_VERSION  "1.0.0"

// --- НАСТРОЙКИ ПИНОВ I2C ---
#define I2C_SDA 5
#define I2C_SCL 6

// U8g2 под экран 0.42" (матрица 72x40 внутри буфера 128x64)
U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, I2C_SCL, I2C_SDA);

// Смещения под экран 0.42"
const int xOffset = 28;
const int yOffset = 24;

// --- UUID ДЛЯ NORDIC UART SERVICE ---
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ СОСТОЯНИЯ ---
BLEServer *pServer = NULL;
BLECharacteristic *pTxCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// --- ОБНОВЛЕНИЕ ЭКРАНА ---
void updateDisplay() {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);

  char buf1[16], buf2[16], buf3[16];
  snprintf(buf1, sizeof(buf1), "%s", DEVICE_NAME);
  snprintf(buf2, sizeof(buf2), "FW: %s", FW_VERSION);
  snprintf(buf3, sizeof(buf3), "BLE: %s", deviceConnected ? "CONNECTED" : "DISCONNECT");

  // Отрисовка со смещениями yOffset и xOffset
  u8g2.drawStr(xOffset, 10 + yOffset, buf1);
  u8g2.drawStr(xOffset, 22 + yOffset, buf2);
  u8g2.drawStr(xOffset, 34 + yOffset, buf3);

  u8g2.sendBuffer();
}

// --- ОБРАБОТКА ПОДКЛЮЧЕНИЙ BLE ---
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) override {
      deviceConnected = true;
      Serial.println("[BLE] Клиент подключен");
    };

    void onDisconnect(BLEServer* pServer) override {
      deviceConnected = false;
      Serial.println("[BLE] Клиент отключен");
    }
};

// --- ОБРАБОТКА ВХОДЯЩИХ КОМАНД С ПРИЛОЖЕНИЯ (RX) ---
class MyRxCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) override {
      String rxValue = pCharacteristic->getValue().c_str();

      if (rxValue.length() > 0) {
        Serial.print("[BLE RX]: ");
        Serial.println(rxValue);

        // Тут дочерние проекты смогут разбирать свои команды
        
        updateDisplay();
      }
    }
};

void setup() {
  Serial.begin(115200);

  // 1. Старт I2C и дисплея U8g2
  Wire.begin(I2C_SDA, I2C_SCL);
  u8g2.begin();
  updateDisplay();

  // 2. Инициализация BLE
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  // TX Характеристика (Notify)
  pTxCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID_TX,
                        BLECharacteristic::PROPERTY_NOTIFY
                      );
  pTxCharacteristic->addDescriptor(new BLE2902());

  // RX Характеристика (Write)
  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
                                           CHARACTERISTIC_UUID_RX,
                                           BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
                                         );
  pRxCharacteristic->setCallbacks(new MyRxCallbacks());

  // Старт сервиса и рассылка имени в эфир
  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Готов к работе, жду подключения...");
}

void loop() {
  // 1. Автоперезапуск Advertising при обрыве связи
  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising(); 
    Serial.println("[BLE] Перезапуск видимости...");
    oldDeviceConnected = deviceConnected;
    updateDisplay();
  }

  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    updateDisplay();
  }

  // 2. Нейтральный системный пинг раз в 5 секунд при активном подключении
  static unsigned long lastTxTime = 0;
  if (deviceConnected && (millis() - lastTxTime > 5000)) {
    lastTxTime = millis();

    char jsonBuf[64];
    snprintf(jsonBuf, sizeof(jsonBuf), "{\"status\":\"online\",\"uptime\":%lu}", millis() / 1000);

    pTxCharacteristic->setValue((uint8_t*)jsonBuf, strlen(jsonBuf));
    pTxCharacteristic->notify();

    Serial.print("[BLE TX Send]: ");
    Serial.println(jsonBuf);
  }
}
