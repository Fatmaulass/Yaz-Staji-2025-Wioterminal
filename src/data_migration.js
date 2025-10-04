// data_migration.js
const fs = require('fs');
const pool = require('./db'); // Adım 1'de oluşturduğumuz bağlantı modülü

async function migrateData() {
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Kullanıcı verilerini ekleme
        const kullanicilarData = fs.readFileSync('kullanicilar.json', 'utf8');
        const kullanicilar = JSON.parse(kullanicilarData);
        console.log(`JSON dosyasından ${kullanicilar.length} kullanıcı bulundu.`);

        for (const kullanici of kullanicilar) {
            await connection.execute(
                'INSERT INTO users (public_key, private_key, balance) VALUES (?, ?, ?)',
                [kullanici.publicKey, kullanici.privateKey, kullanici.bakiye]
            );
        }
        console.log('Kullanıcı verileri başarıyla users tablosuna eklendi.');

        // 2. Blok verilerini ekleme
        const zincirData = fs.readFileSync('zincir.json', 'utf8');
        const blockchain = JSON.parse(zincirData);
        console.log(`JSON dosyasından ${blockchain.zincir.length} blok bulundu.`);
        
        // Önceki hash'ler için bir harita oluşturun (blok id'lerini saklamak için)
        const blockHashToId = {};

        for (const blok of blockchain.zincir) {
            const [result] = await connection.execute(
                'INSERT INTO blocks (hash, previous_hash, timestamp, nonce, difficulty, miner_reward) VALUES (?, ?, ?, ?, ?, ?)',
                [
                    blok.hash,
                    blok.oncekiHash,
                    blok.zamanDamgasi,
                    blok.nonce,
                    blockchain.zorluk, // Blockchain seviyesinden al
                    blockchain.madenciOdulu // Blockchain seviyesinden al
                ]
            );
            const blockId = result.insertId;
            blockHashToId[blok.hash] = blockId;
            
            // İşlem verilerini ekleme
            for (const islem of blok.islemler) {
                await connection.execute(
                    'INSERT INTO transactions (block_id, sender_address, receiver_address, amount, fee, timestamp, signature) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [
                        blockId,
                        islem.gonderenAdres,
                        islem.aliciAdres,
                        islem.miktar,
                        islem.ucret || 0,
                        islem.zamanDamgasi,
                        islem.imza || null
                    ]
                );
            }
        }
        console.log('Blok ve işlem verileri başarıyla blocks ve transactions tablolarına eklendi.');

        // 3. Bekleyen işlemler verilerini ekleme
        const bekleyenIslemler = blockchain.bekleyenIslemler;
        console.log(`JSON dosyasından ${bekleyenIslemler.length} bekleyen işlem bulundu.`);
        
        for (const islem of bekleyenIslemler) {
            await connection.execute(
                'INSERT INTO pending_transactions (sender_address, receiver_address, amount, fee, timestamp, signature) VALUES (?, ?, ?, ?, ?, ?)',
                [
                    islem.gonderenAdres,
                    islem.aliciAdres,
                    islem.miktar,
                    islem.ucret || 0,
                    islem.zamanDamgasi,
                    islem.imza || null
                ]
            );
        }
        console.log('Bekleyen işlemler başarıyla pending_transactions tablosuna eklendi.');

        await connection.commit();
        console.log('Tüm veriler başarıyla veritabanına aktarıldı.');

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Veri aktarımı sırasında bir hata oluştu:', error);
    } finally {
        if (connection) {
            connection.release();
        }
        pool.end();
    }
}

migrateData();