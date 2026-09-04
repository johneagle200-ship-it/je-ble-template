#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Update.h>
#include <ArduinoJson.h>

#define DEVICE_NAME "JE_BaseDevice"
#define FW_VERSION  "1.0.0"

#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

BLEServer *pServer = NULL;
BLECharacteristic *pTxCharacteristic;
bool deviceConnected = false;
bool otaMode = false;

// Отправка системных данных приложения (Handshake)
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

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      pServer->getAdvertising()->start();
    }
};

class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      uint8_t* rxValue = pCharacteristic->getData();
      size_t length = pCharacteristic->getLength();

      if (length == 0) return;

      // Прием бинарных пакетов прошивки OTA
      if (otaMode) {
        if (rxValue[0] == '{') {
          StaticJsonDocument<200> doc;
          deserializeJson(doc, rxValue, length);
          if (doc["cmd"] == "OTA_END") {
            if (Update.end(true)) {
              ESP.restart();
            }
            otaMode = false;
            return;
          }
        }
        Update.write(rxValue, length);
        return;
      }

      // Прием JSON-команд управления и синхронизации
      if (rxValue[0] == '{') {
        StaticJsonDocument<200> doc;
        DeserializationError error = deserializeJson(doc, rxValue, length);
        if (!error) {
          if (doc["cmd"] == "get_sys") {
            sendHandshake();
          } else if (doc["cmd"] == "OTA_START") {
            size_t otaSize = doc["size"];
            if (Update.begin(otaSize)) {
              otaMode = true;
            }
          }
        }
      }
    }
};

void setup() {
  Serial.begin(115200);

  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  pTxCharacteristic = pService->createCharacteristic(CHARACTERISTIC_UUID_TX, BLECharacteristic::PROPERTY_NOTIFY);
  pTxCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(CHARACTERISTIC_UUID_RX, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pRxCharacteristic->setCallbacks(new MyCallbacks());

  pService->start();
  pServer->getAdvertising()->start();
  Serial.println("JE BLE Устройство готово!");
}

void loop() {
  static unsigned long lastTime = 0;

  // Нейтральная телеметрия: пинг устройства раз в 5 секунд
  if (deviceConnected && !otaMode && millis() - lastTime > 5000) {
    lastTime = millis();
    
    StaticJsonDocument<100> doc;
    doc["status"] = "online";
    doc["uptime"] = millis() / 1000;

    String output;
    serializeJson(doc, output);
    pTxCharacteristic->setValue(output.c_str());
    pTxCharacteristic->notify();
  }
}
