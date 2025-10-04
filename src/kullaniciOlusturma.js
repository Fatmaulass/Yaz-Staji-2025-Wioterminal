const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const { Islem, Blok } = require('./blockchain'); // Not: Artık BlokZinciri'ne ihtiyacımız yok
const pool = require('./db'); // Veritabanı bağlantı havuzu

const KAC_KULLANICI = 3;
const BASLANGIC_BAKIYESI = 1000;

async function kullanicilariOlustur() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Mevcut kullanıcıları kontrol et
    const [mevcutKullanicilar] = await connection.execute('SELECT COUNT(*) AS count FROM users');
    const mevcutKullaniciSayisi = mevcutKullanicilar[0].count;

    let yeniKullanicilar = [];
    for (let i = 1; i <= KAC_KULLANICI; i++) {
      const key = ec.genKeyPair();
      const kullanici = {
        id: `kullanici ${mevcutKullaniciSayisi + i}`,
        publicKey: key.getPublic('hex'),
        privateKey: key.getPrivate('hex'),
        bakiye: BASLANGIC_BAKIYESI
      };
      yeniKullanicilar.push(kullanici);
    }
    console.log(`${KAC_KULLANICI} yeni kullanıcı oluşturuldu.`);

    // Kullanıcıları users tablosuna ekle
    for (const kullanici of yeniKullanicilar) {
      await connection.execute(
        'INSERT INTO users (public_key, private_key, balance) VALUES (?, ?, ?)',
        [kullanici.publicKey, kullanici.privateKey, kullanici.bakiye]
      );
    }
    console.log('Yeni kullanıcılar veritabanına kaydedildi.');

    // Genesis blokta her kullanıcıya başlangıç bakiyesi veren işlemleri oluştur
    const genesisIslemleri = yeniKullanicilar.map(kullanici => {
      return new Islem(null, kullanici.publicKey, BASLANGIC_BAKIYESI);
    });

    // Genesis bloğu oluştur
    const genesisBlok = new Blok(Date.now(), genesisIslemleri, '0');
    genesisBlok.bloguMineEt(4); // Genesis bloğunu da madenle
    console.log('Genesis blok oluşturuldu.');

    // Genesis bloğu ve işlemlerini veritabanına kaydet
    const [result] = await connection.execute(
      'INSERT INTO blocks (hash, previous_hash, timestamp, nonce, difficulty, miner_reward) VALUES (?, ?, ?, ?, ?, ?)',
      [genesisBlok.hash, genesisBlok.oncekiHash, genesisBlok.zamanDamgasi, genesisBlok.nonce, 4, 0]
    );
    const genesisBlockId = result.insertId;

    for (const islem of genesisIslemleri) {
      await connection.execute(
        'INSERT INTO transactions (block_id, sender_address, receiver_address, amount, fee, timestamp, signature) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [genesisBlockId, islem.gonderenAdres, islem.aliciAdres, islem.miktar, islem.ucret, islem.zamanDamgasi, islem.imza || null]
      );
    }

    await connection.commit();
    console.log('Genesis blok ve işlemleri veritabanına kaydedildi.');

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Kullanıcı oluşturma veya veri aktarımı sırasında hata:', error);
  } finally {
    if (connection) {
      connection.release();
    }
    pool.end();
  }
}

if (require.main === module) {
  kullanicilariOlustur();
}