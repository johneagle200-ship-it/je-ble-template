#include <Arduino.h>
#include <U8g2lib.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Update.h>
#include <ArduinoJson.h>

#define DEVICE_NAME "JE_BaseDevice"
#define FW_VERSION  "1.0.0"

// --- НАСТРОЙКИ ПИНОВ I2C И ДИСПЛЕЯ ---
#define I2C_SDA 5
#define I2C_SCL 6

U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, I2C_SCL, I2C_SDA);

const int xOffset = 28;
const int yOffset = 24;

// --- UUID NORDIC UART SERVICE ---
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ СОСТОЯНИЯ ---
BLEServer *pServer = NULL;
BLECharacteristic *pTxCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;
bool otaMode = false;

// --- ОБНОВЛЕНИЕ ЭКРАНА ---
void updateDisplay(const char* customStatus = NULL) {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);

  char buf1[16], buf2[16], buf3[16];
  snprintf(buf1, sizeof(buf1), "%s", DEVICE_NAME);
  snprintf(buf2, sizeof(buf2), "FW: %s", FW_VERSION);

  if (customStatus) {
    snprintf(buf3, sizeof(buf3), "%s", customStatus);
  } else {
    snprintf(buf3, sizeof(buf3), "BLE: %s", deviceConnected ? "CONNECTED" : "DISCONNECT");
  }

  u8g2.drawStr(xOffset, 10 + yOffset, buf1);
  u8g2.drawStr(xOffset, 22 + yOffset, buf2);
  u8g2.drawStr(xOffset, 34 + yOffset, buf3);

  u8g2.sendBuffer();
}

// --- ОТПРАВКА HANDSHAKE ПРИЛОЖЕНИЮ ---
void sendHandshake() {
  StaticJsonDocument<200> doc;
  JsonObject sys = doc.createNestedObject("sys");
  sys["fw"] = FW_VERSION;
  sys["dev"] = DEVICE_NAME;

  String output;
  serializeJson(doc, output);
  pTxCharacteristic->setValue(output.c_str());
  pTxCharacteristic->notify();
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

// --- ОБРАБОТКА ВХОДЯЩИХ ДАННЫХ И OTA ---
class MyRxCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) override {
      std::string rxValue = pCharacteristic->getValue();
      if (rxValue.length() == 0) return;

      // 1. Прием бинарных пакетов прошивки (Режим OTA)
      if (otaMode) {
        if (rxValue[0] == '{') {
          StaticJsonDocument<200> doc;
          deserializeJson(doc, rxValue);
          if (doc["cmd"] == "OTA_END") {
            if (Update.end(true)) {
              updateDisplay("OTA SUCCESS");
              Serial.println("[OTA] Прошивка успешно загружена! Перезагрузка...");
              delay(1000);
              ESP.restart();
            } else {
              otaMode = false;
              updateDisplay("OTA ERROR");
              Serial.println("[OTA] Ошибка завершения прошивки");
            }
            return;
          }
        }
        // Запись чанка байт во Flash
        Update.write((uint8_t*)rxValue.data(), rxValue.length());
        return;
      }

      // 2. Прием стандартных JSON-команд
      if (rxValue[0] == '{') {
        StaticJsonDocument<200> doc;
        DeserializationError error = deserializeJson(doc, rxValue);
        if (!error) {
          if (doc["cmd"] == "get_sys") {
            sendHandshake();
          } else if (doc["cmd"] == "OTA_START") {
            size_t otaSize = doc["size"];
            if (Update.begin(otaSize)) {
              otaMode = true;
              updateDisplay("OTA UPDATING...");
              Serial.printf("[OTA] Старт загрузки прошивки размером %d байт\n", otaSize);
            }
          }
        }
      }
    }
};

void setup() {
  Serial.begin(115200);

  // Старт I2C и дисплея
  Wire.begin(I2C_SDA, I2C_SCL);
  u8g2.begin();
  updateDisplay();

  // Инициализация BLE
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pTxCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID_TX,
                        BLECharacteristic::PROPERTY_NOTIFY
                      );
  pTxCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
                                           CHARACTERISTIC_UUID_RX,
                                           BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
                                         );
  pRxCharacteristic->setCallbacks(new MyRxCallbacks());

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Готов к работе!");
}

void loop() {
  // Перезапуск вещания при обрыве
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

  // Пинг телеметрии раз в 5 секунд (только если не идет OTA)
  static unsigned long lastTxTime = 0;
  if (deviceConnected && !otaMode && (millis() - lastTxTime > 5000)) {
    lastTxTime = millis();

    char jsonBuf[64];
    snprintf(jsonBuf, sizeof(jsonBuf), "{\"status\":\"online\",\"uptime\":%lu}", millis() / 1000);

    pTxCharacteristic->setValue((uint8_t*)jsonBuf, strlen(jsonBuf));
    pTxCharacteristic->notify();
  }
}
