#include <Arduino.h>
#include <TFT_eSPI.h>
#include <ArduinoJson.h>
#include <uECC.h>

#define BAUD_RATE 115200

TFT_eSPI tft = TFT_eSPI();

// Özel anahtarınız
const char* PRIVATE_KEY_HEX = "551ca6da73f2c81692b6bfcb03fef2d135fb7ebfa309c708d760f730dd42ea37";

// Global durum değişkenleri
String gelenHashString = "";
bool imzaBekliyor = false;

// --- YARDIMCI FONKSİYONLAR (Hex Çevrimleri ve RNG) ---

uint8_t hexCharToByte(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return 0;
}

void hexToBytes(const char* hex, uint8_t* bytes, size_t len) {
    for (size_t i = 0; i < len; i++) {
        bytes[i] = hexCharToByte(hex[i * 2]) * 16 + hexCharToByte(hex[i * 2 + 1]);
    }
}

void bytesToHex(const uint8_t* bytes, char* hex, size_t len) {
    for (size_t i = 0; i < len; i++) {
        sprintf(&hex[i * 2], "%02x", bytes[i]);
    }
    hex[len * 2] = '\0';
}

int rng_function(uint8_t *dest, unsigned int size) {
    while (size) {
        *dest = random(0, 256);
        dest++;
        size--;
    }
    return 1;
}

// --- YENİ EKRAN YÖNETİM FONKSİYONLARI ---

/**
 * @brief Ekranın sadece durum metni kısmını temizler ve günceller.
 * @param mesaj Gösterilecek yeni durum metni.
 * @param renk Metnin rengi.
 */
void durumuGuncelle(const char* mesaj, uint16_t renk) {
    tft.fillRect(0, 80, 320, 40, TFT_BLACK); // Sadece durum alanını temizle
    tft.setTextColor(renk);
    tft.setTextSize(2);
    tft.drawCentreString(mesaj, 160, 90, 2); // Metni ortala
}

/**
 * @brief Ekranın altındaki talimat alanını temizler ve günceller.
 * @param mesaj Gösterilecek yeni talimat metni.
 * @param renk Metnin rengi.
 */
void talimatiGoster(const char* mesaj, uint16_t renk) {
    tft.fillRect(0, 180, 320, 40, TFT_BLACK); // Sadece talimat alanını temizle
    tft.setTextColor(renk);
    tft.setTextSize(2);
    tft.drawCentreString(mesaj, 160, 190, 2); // Metni ortala
}

/**
 * @brief Ekranın sabit arka planını ve başlığını çizer. Sadece setup'ta bir kez çağrılır.
 */
void ekraniHazirla() {
    tft.fillScreen(TFT_BLACK);
    
    // Başlık
    tft.setTextColor(TFT_BLUE, TFT_BLACK);
    tft.setTextSize(3);
    tft.drawCentreString("Cuzdanim", 160, 15, 1);
    
    // Ayırıcı çizgi
    tft.drawFastHLine(10, 42, 300, TFT_DARKGREEN);

    // Durum Başlığı
    tft.setTextColor(TFT_PURPLE, TFT_BLACK);
    tft.setTextSize(1);
    tft.drawCentreString("DURUM", 155, 55, 4);
}


// --- ANA FONKSİYONLAR ---

void imzalaVeGonder() {
    // Önceki talimatı temizle ve yeni durumu göster
    talimatiGoster("", TFT_BLACK);
    durumuGuncelle("Imzalaniyor...", TFT_ORANGE);

    const char* hashToSignHex = gelenHashString.c_str();
    uint8_t hashToSign[32];
    uint8_t privateKeyBytes[32];
    uint8_t signature[64];
    
    hexToBytes(hashToSignHex, hashToSign, 32);
    hexToBytes(PRIVATE_KEY_HEX, privateKeyBytes, 32);
    
    if (uECC_sign(privateKeyBytes, hashToSign, sizeof(hashToSign), signature, uECC_secp256k1()) != 1) {
        durumuGuncelle("HATA: Imza Basarisiz!", TFT_RED);
        delay(5000); // Kullanıcının hatayı görmesi için bekle
    } else {
        char signatureHex[129];
        bytesToHex(signature, signatureHex, 64);
        
        StaticJsonDocument<200> responseDoc;
        responseDoc["imza"] = signatureHex;
        
        String response;
        serializeJson(responseDoc, response);
        Serial.println(response);

        durumuGuncelle("Imza Gonderildi", TFT_GREEN);
        delay(4000); // Kullanıcının başarı mesajını görmesi için bekle
    }

    // İşlem bittikten sonra başlangıç durumuna dön
    imzaBekliyor = false;
    gelenHashString = "";
    durumuGuncelle("Sunucudan Bekleniyor...", TFT_CYAN);
}

void setup() {
    Serial.begin(BAUD_RATE);
    tft.init();
    tft.setRotation(3);
    
    ekraniHazirla(); // Yeni arayüzü çiz
    durumuGuncelle("Sunucudan Bekleniyor...", TFT_CYAN); // Başlangıç durumunu ayarla

    uECC_set_rng(&rng_function);
    randomSeed(analogRead(0));
    pinMode(WIO_KEY_A, INPUT_PULLUP);
}

void loop() {
    if (Serial.available()) {
        String gelen = Serial.readStringUntil('\n');
        gelen.trim();

        if (gelen.length() > 0) {
            StaticJsonDocument<256> doc;
            if (deserializeJson(doc, gelen) == DeserializationError::Ok && doc.containsKey("hash")) {
                gelenHashString = doc["hash"].as<String>();
                imzaBekliyor = true;
                
                // Yeni durumu ve talimatı ekrana yansıt
                durumuGuncelle("Onay Bekleniyor", TFT_YELLOW);
                talimatiGoster("ONAY ICIN TUSLAYIN", TFT_WHITE);

                Serial.println("Hash alindi, KEY A bekleniyor...");
            }
        }
    }
    
    if (imzaBekliyor && digitalRead(WIO_KEY_A) == LOW) {
        imzalaVeGonder();
    }
}