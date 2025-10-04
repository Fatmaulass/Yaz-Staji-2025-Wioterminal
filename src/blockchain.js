const SHA256 = require("crypto-js/sha256");
const { verify } = require("@noble/secp256k1");

class Islem {
    constructor(gonderenAdres, aliciAdres, miktar, ucret, zamanDamgasi) {
        this.gonderenAdres = gonderenAdres;
        this.aliciAdres = aliciAdres;
        this.miktar = miktar;
        this.ucret = ucret || 0;
        this.zamanDamgasi = zamanDamgasi || Date.now();
    }

    hashHesapla() {
        const gonderen = this.gonderenAdres || '';
        const alici = this.aliciAdres || '';
        const miktarStr = Number(this.miktar || 0).toFixed(8);
        const ucretStr = Number(this.ucret || 0).toFixed(8);
        const zamanDamgasiStr = String(this.zamanDamgasi);
        const stringToHash = gonderen + alici + miktarStr + ucretStr + zamanDamgasiStr;
        return SHA256(stringToHash).toString();
    }

    gecerliMi() {
        if (this.gonderenAdres === null) return true;
        if (!this.imza || this.imza.length === 0) return false;
        try {
            const hashHex = this.hashHesapla();
            const isValid = verify(this.imza, hashHex, this.gonderenAdres);
            if (!isValid) console.warn(">>> UYARI: İmza Doğrulanamadı!");
            return isValid;
        } catch (e) {
            console.error("Doğrulama sırasında hata:", e.message);
            return false;
        }
    }
}

class Blok {
    constructor(zamanDamgasi, islemler, oncekiHash = "") {
        this.oncekiHash = oncekiHash;
        this.zamanDamgasi = zamanDamgasi;
        this.islemler = islemler;
        this.nonce = 0;
        this.hash = this.hashHesapla();
    }

    hashHesapla() {
        return SHA256(this.oncekiHash + this.zamanDamgasi + JSON.stringify(this.islemler) + this.nonce).toString();
    }

    bloguMineEt(zorluk) {
        while (this.hash.substring(0, zorluk) !== Array(zorluk + 1).join("0")) {
            this.nonce++;
            this.hash = this.hashHesapla();
        }
    }
}

class BlokZinciri {
    static async sonBlok(pool) {
        const [rows] = await pool.execute('SELECT * FROM blocks ORDER BY timestamp DESC LIMIT 1');
        if (rows.length === 0) {
            return new Blok(Date.now(), "Genesis Blok", "0");
        }
        const blokData = rows[0];
        const [islemRows] = await pool.execute('SELECT * FROM transactions WHERE block_id = ?', [blokData.id]);
        const islemler = islemRows.map(row => {
            const islem = new Islem(row.sender_address, row.receiver_address, parseFloat(row.amount), parseFloat(row.fee), parseInt(row.timestamp, 10));
            islem.imza = row.signature;
            return islem;
        });
        const blok = new Blok(blokData.timestamp, islemler, blokData.previous_hash);
        blok.hash = blokData.hash;
        blok.nonce = blokData.nonce;
        return blok;
    }

    static async bekleyenIslemleriMineEt(madenciAdresi, pool) {
        const [pendingTransactions] = await pool.execute('SELECT * FROM pending_transactions ORDER BY id ASC LIMIT 5');
        if (pendingTransactions.length === 0) return;

        const sonBlok = await this.sonBlok(pool);
        let gecerliIslemler = []; 
        let toplamIslemUcretleri = 0;
        const madenciOdulu = 100;
        const zorluk = 4;

        console.log(`Bloğa eklenmek üzere ${pendingTransactions.length} adet bekleyen işlem bulundu. Doğrulanıyor...`);

        for (const row of pendingTransactions) {
            const islem = new Islem(row.sender_address, row.receiver_address, parseFloat(row.amount), parseFloat(row.fee), parseInt(row.timestamp, 10));
            islem.imza = row.signature;
            if (islem.gecerliMi()) {
                console.log(`İşlem doğrulandı ve bloğa eklenmeye hazır.`);
                gecerliIslemler.push(islem);
                toplamIslemUcretleri += islem.ucret;
            } else {
                console.error(`!!! GÜVENLİK UYARISI: Geçersiz imzalı bir işlem atlandı.`);
            }
        }

        if (gecerliIslemler.length === 0) {
            console.log("Tüm bekleyen işlemler geçersizdi veya havuz boştu. Madencilik bu tur için iptal edildi.");
            const idsToDelete = pendingTransactions.map(t => t.id);
            if (idsToDelete.length > 0) {
                await pool.execute(`DELETE FROM pending_transactions WHERE id IN (?)`, [idsToDelete]);
            }
            return;
        }

        const odulIslemi = new Islem(null, madenciAdresi, madenciOdulu + toplamIslemUcretleri);
        odulIslemi.imza = null;
        gecerliIslemler.push(odulIslemi);

        const yeniBlok = new Blok(Date.now(), gecerliIslemler, sonBlok.hash);
        yeniBlok.bloguMineEt(zorluk);

        let connection;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();

            const [result] = await connection.execute(
                'INSERT INTO blocks (hash, previous_hash, timestamp, nonce, difficulty, miner_reward) VALUES (?, ?, ?, ?, ?, ?)',
                [yeniBlok.hash, yeniBlok.oncekiHash, yeniBlok.zamanDamgasi, yeniBlok.nonce, zorluk, madenciOdulu]
            );
            const blockId = result.insertId;

            for (const islem of yeniBlok.islemler) {
                await connection.execute(
                    'INSERT INTO transactions (block_id, sender_address, receiver_address, amount, fee, timestamp, signature) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [blockId, islem.gonderenAdres, islem.aliciAdres, islem.miktar, islem.ucret, islem.zamanDamgasi, islem.imza]
                );
            }

            const idsToDelete = pendingTransactions.map(t => t.id);
            if (idsToDelete.length > 0) {
                await connection.execute(`DELETE FROM pending_transactions WHERE id IN (${idsToDelete.map(() => '?').join(',')})`, idsToDelete);
            }
            const bakiyeler = {};
            for (const islem of gecerliIslemler) {
                if (islem.gonderenAdres) {
                    bakiyeler[islem.gonderenAdres] = (bakiyeler[islem.gonderenAdres] || 0) - (islem.miktar + islem.ucret);
                }
                if (islem.aliciAdres) {
                    bakiyeler[islem.aliciAdres] = (bakiyeler[islem.aliciAdres] || 0) + islem.miktar;
                }
            }
             bakiyeler[madenciAdresi] = (bakiyeler[madenciAdresi] || 0) + madenciOdulu + toplamIslemUcretleri;
            for (const adres in bakiyeler) {
                await connection.execute('UPDATE users SET balance = balance + ? WHERE public_key = ?', [bakiyeler[adres], adres]);
            }
            await connection.commit();
        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Madencilik sırasında veritabanı hatası:', error);
            throw error;
        } finally {
            if (connection) connection.release();
        }
    }
}

module.exports = { BlokZinciri, Islem, Blok };