// imzaIstek.js
const { SerialPort } = require('serialport');
const {ReadlineParser} = require('@serialport/parser-readline');

const port = new SerialPort({ path: 'COM7', baudRate: 115200 }, (err) => {
    if (err) {
        return console.error('Port açma hatası:', err.message);
    } else {
        console.log('Seri port başarıyla açıldı');
    }
});

const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

function imzaAl(islemJson) {
    return new Promise((resolve, reject) => {
        let timeoutId;
        
        const handleData = (data) => {
            const dataString = data.toString().trim();
            console.log('Wio Terminal\'den gelen veri:', dataString);
            if (dataString.startsWith('{') && dataString.endsWith('}')) {
                try {
                    const imzaCevap = JSON.parse(dataString);
                    if (imzaCevap.imza) { // Tek bir 'imza' değeri bekliyoruz
                        clearTimeout(timeoutId);
                        parser.off('data', handleData);
                        resolve(imzaCevap.imza); // imza değerini resolve et
                    } else {
                        console.warn('Seri porttan imza verisi gelmedi, göz ardı ediliyor.');
                    }
                } catch (e) {
                    console.warn('Seri porttan JSON parse hatası (göz ardı ediliyor):', e.message, '-> Gelen:', dataString);
                }
            }
        };

        parser.on('data', handleData);
        
        // Wio Terminal'e işlem JSON'unu string olarak gönder
        port.write(JSON.stringify(islemJson) + '\n', (err) => {
            if (err) {
                clearTimeout(timeoutId);
                parser.off('data', handleData);
                return reject('Seri porta yazma hatası: ' + err.message);
            }
        });

        // Zaman aşımı ekle
        timeoutId = setTimeout(() => {
            parser.off('data', handleData);
            reject('Wio Terminal\'den imza cevabı alınamadı (zaman aşımı).');
        }, 15000); // 15 saniye zaman aşımı
    });
}

module.exports = { imzaAl };