const express = require('express');
const bodyParser = require('body-parser');
const { ec } = require('elliptic');
const http = require('http'); // HTTP modülünü ekleyin
const WebSocket = require('ws'); // Yeni yüklediğimiz 'ws' kütüphanesi
const { BlokZinciri, Islem } = require('./blockchain');
const { imzaAl } = require('./imzaIstek');
const pool = require('./db'); // Veritabanı bağlantı havuzu

const app = express();
const elliptic = new ec('secp256k1');
const port = 3000;

app.use(bodyParser.json());
app.use(require('cors')());

const server = http.createServer(app);

// WebSocket sunucusunu bu HTTP sunucusuna bağla
const wss = new WebSocket.Server({ server });

// Bağlı olan tüm istemcileri (tarayıcıları) takip etmek için bir set oluşturalım
const clients = new Set();

// Her yeni istemci bağlandığında çalışacak kod
wss.on('connection', (ws) => {
    clients.add(ws);

    // İstemcinin bağlantısı koptuğunda çalışacak kod
    ws.on('close', () => {
        clients.delete(ws);
    });
});

// Tüm bağlı istemcilere mesaj gönderecek yardımcı bir fonksiyon
function broadcast(data) {
    const jsonData = JSON.stringify(data);
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    }
}
server.listen(port, () => {
    console.log(`API ve WebSocket sunucusu çalışıyor: http://localhost:${port}`);
});

// Kullanıcı doğrulama API'si
app.get('/api/kullanici-dogrula', async (req, res) => {
    const gelenPublicKey = req.query.publicKey;
    if (!gelenPublicKey) {
        return res.status(400).json({ hata: 'publicKey gerekli' });
    }
    try {
        const [rows] = await pool.execute('SELECT public_key FROM users WHERE public_key = ?', [gelenPublicKey]);
        if (rows.length > 0) {
            res.json({ mesaj: 'Kullanıcı doğrulandı', dogrulandi: true });
        } else {
            res.status(404).json({ hata: 'Kullanıcı bulunamadı', dogrulandi: false });
        }
    } catch (error) {
        console.error('Veritabanı hatası:', error.message);
        res.status(500).json({ hata: 'Sunucu hatası', mesaj: 'Kullanıcı verisi okunamadı.' });
    }
});

// Bakiye sorgulama API'si
app.get('/api/bakiye', async (req, res) => {
    const adres = req.query.adres;
    if (!adres) return res.status(400).json({ hata: 'Adres gerekli' });
    const [rows] = await pool.execute('SELECT balance FROM users WHERE public_key = ?', [adres]);
    if (rows.length > 0) {
        res.json({ bakiye: rows[0].balance });
    } else {
        res.status(404).json({ hata: 'Adres bulunamadı' });
    }
});

app.post('/api/gonder-imzali', async (req, res) => {
    try {
        const { gonderenAdres, aliciAdres, miktar, ucret, zamanDamgasi } = req.body;

        if (gonderenAdres === aliciAdres) {
            return res.status(400).json({ hata: 'Gönderen ve alıcı adresleri aynı olamaz.' });
        }

        // Alıcı adresinin sistemde kayıtlı olup olmadığını veritabanından kontrol et
        const [aliciRows] = await pool.execute('SELECT public_key FROM users WHERE public_key = ?', [aliciAdres]);
        if (aliciRows.length === 0) {
            return res.status(404).json({ hata: 'Alıcı adresi sistemde kayıtlı değil. Lütfen geçerli bir adres girin.' });
        }

        const islem = new Islem(gonderenAdres, aliciAdres, miktar, ucret, parseInt(zamanDamgasi, 10));
        const hashHex = islem.hashHesapla();

        const imzaIstekVerisi = { hash: hashHex };
        const imza = await imzaAl(imzaIstekVerisi);
        islem.imza = imza;

        if (!islem.gecerliMi()) {
            return res.status(500).json({ hata: 'Kritik imza doğrulama hatası.' });
        }

        // İşlemi pending_transactions tablosuna ekle
        await pool.execute(
            'INSERT INTO pending_transactions (sender_address, receiver_address, amount, fee, timestamp, signature) VALUES (?, ?, ?, ?, ?, ?)',
            [islem.gonderenAdres, islem.aliciAdres, islem.miktar, islem.ucret, islem.zamanDamgasi, islem.imza]
        );
        broadcast({ type: 'MEMPOOL_GUNCELLENDI' }); // Tüm tarayıcılara haber ver     
        res.json({ mesaj: 'İşlem başarıyla imzalandı ve bekleyen işlemler havuzuna eklendi.' });

    } catch (err) {
        console.error("İmza veya veritabanı hatası:", err);
        res.status(500).json({ hata: 'İşlem sırasında bir hata oluştu: ' + err.message });
    }
});

// Bekleyen işlem havuzunu (mempool) getiren API endpoint'i
app.get('/api/bekleyen-islemler', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT sender_address, receiver_address, amount FROM pending_transactions ORDER BY id ASC`
        );
        res.json(rows);
    } catch (error) {
        console.error('Bekleyen işlemler sorgulama hatası:', error);
        res.status(500).json({ hata: 'Sunucu hatası' });
    }
});

// Madencilik işlemini periyodik yapan kısım
let bekleyenIslemMesajiGosterildi = false;
setInterval(async () => {
    try {
        const [rows] = await pool.execute('SELECT COUNT(*) AS count FROM pending_transactions');

        if (rows[0].count > 0) {
            console.log('Madencilik işlemi başlatılıyor...');

            // Mesajın tekrar gösterilebilmesi için değişkeni sıfırla
            bekleyenIslemMesajiGosterildi = false;

            const [kullaniciRows] = await pool.execute('SELECT public_key FROM users');
            const rastgeleMadenciIndex = Math.floor(Math.random() * kullaniciRows.length);
            const madenciAdresi = kullaniciRows[rastgeleMadenciIndex].public_key;

            await BlokZinciri.bekleyenIslemleriMineEt(madenciAdresi, pool);
            console.log('Yeni blok madenciliği tamamlandı ve veritabanına eklendi.');
            broadcast({ type: 'BLOK_KAZILDI' }); // Tüm tarayıcılara haber ver

        } else {
            // Sadece daha önce mesaj gösterilmediyse konsola yazdır
            if (!bekleyenIslemMesajiGosterildi) {
                console.log('Bekleyen işlem yok, madencilik bir sonraki işlem eklenene kadar duraklatıldı.');
                bekleyenIslemMesajiGosterildi = true; // Mesajın gösterildiğini işaretle
            }
        }
    } catch (error) {
        console.error("Madencilik döngüsü sırasında bir hata oluştu:", error);
        // Hata durumunda da bir sonraki denemede mesajın gösterilmesi için sıfırlanabilir
        bekleyenIslemMesajiGosterildi = false;
    }
}, 55000);
