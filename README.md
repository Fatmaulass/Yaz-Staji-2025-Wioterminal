Bu aşama, blockchain altyapısının üzerine bir güvenlik katmanı ekliyor: fiziksel bir donanım cüzdanı (hardware wallet). Projenin eksik olan ve yeni eklenen kısımları, işlemleri daha güvenli hale getirmek için Wio Terminal'in kullanılması etrafında şekilleniyor.
Projenin Yeni Amacı: Donanım Cüzdanı ile İşlem İmzalama
Önceki projede, bir kullanıcı para göndermek istediğinde, işlemi tarayıcıda (istemci tarafında) kendi özel anahtarı (private key) ile imzalıyordu. Bu özel anahtar, index.html'deki giriş kutusuna yapıştırılıyordu. Bu yöntem işlevsel olsa da özel anahtarın potansiyel olarak güvensiz bir ortam olan web tarayıcısına girilmesi bir güvenlik riskidir.
Bu yeni proje, bu riski ortadan kaldırır. Özel anahtar, Wio Terminal cihazından asla dışarı çıkmaz. Bunun yerine, işlem verisinin özeti (hash) Wio Terminal'e gönderilir, imzalama işlemi cihaz üzerinde yapılır ve sadece üretilen dijital imza (signature) sunucuya geri gönderilir.
Eksik ve Yeni Eklenen Kısımların Detaylı Açıklaması
1. Wio Terminal: Fiziksel İmza Cihazı (ardunioKodu.cpp)
Bu, projenin en temel yeni parçasıdır. Wio Terminal, tek bir görev için programlanmış bir "donanım cüzdanı" görevi görür:
•	Görevi: Seri port üzerinden kendisine gönderilen bir işlem özetini (hash) almak, cihazda saklanan özel anahtar ile bu özeti imzalamak ve sonucu geri göndermek.
•	Güvenlik: PRIVATE_KEY_HEX olarak tanımlanan özel anahtar, cihazın kodunda sabit olarak bulunur ve cihazdan asla ayrılmaz. Bu, "cold storage" (soğuk depolama) konseptine benzer bir güvenlik sağlar.
•	Fiziksel Onay: İmzalama işlemi otomatik olarak yapılmaz. Kullanıcının Wio Terminal üzerindeki WIO_KEY_A düğmesine fiziksel olarak basması gerekir. Bu, kullanıcının her işlemi bizzat onayladığını garanti eder ve kötü amaçlı yazılımların kullanıcının haberi olmadan işlem imzalamasını engeller.
•	Kütüphaneler: 
o	TFT_eSPI.h: Wio Terminal'in ekranını kullanarak kullanıcıya "Hash alındı, onayla" gibi bilgiler vermek için kullanılır.
o	ArduinoJson.h: Node.js sunucusundan gelen ve sunucuya gönderilen verileri JSON formatında işlemek için kullanılır.
o	uECC.h: Eliptik Eğri Kriptografisi (ECC) işlemlerini, özellikle de secp256k1 eğrisi üzerinde dijital imza oluşturmayı (uECC_sign) sağlayan mikrodenetleyici uyumlu bir kütüphanedir.
2. Seri Port İletişim Köprüsü (imzaIstek.js)
Node.js sunucusu ile USB portuna bağlı Wio Terminal arasındaki iletişimi sağlayan ara katmandır.
•	Görevi: Sunucudan aldığı işlem özetini (hash) Wio Terminal'e seri port üzerinden göndermek ve Wio Terminal'den gelen imzayı dinleyip sunucuya geri döndürmek.
•	Promise Tabanlı Yapı: imzaAl fonksiyonu, bir Promise döndürür. Bu, işlemin asenkron doğasını yönetir. Sunucu, imza isteğini gönderir ve Wio Terminal'den cevap gelene kadar (veya zaman aşımına uğrayana kadar) bekler.
•	Kütüphaneler:
o	serialport: Node.js'in bilgisayarın seri portları (örneğin, Wio Terminal'in bağlı olduğu COM portu) ile konuşmasını sağlayan temel kütüphanedir.
o	@serialport/parser-readline: Seri porttan gelen veriyi satır satır okumayı kolaylaştırır, bu da Wio Terminal'den gelen JSON verisini daha kolay işlemeyi sağlar.
3. Güncellenmiş Sunucu Mantığı (server.js)
Sunucunun para gönderme uç noktası (/api/gonder-imzali) artık tamamen farklı çalışmaktadır.
•	Eski Akış: Tarayıcıdan imzalı işlem geliyordu. Sunucu sadece bu imzayı doğruluyordu.
•	Yeni Akış:
1.	Tarayıcı (index.html), artık imza oluşturmadan, sadece kimin kime ne kadar göndermek istediği bilgisini (gönderen, alıcı, miktar) sunucuya yollar.
2.	Sunucu, bu bilgilerle güvenilir bir Islem nesnesi oluşturur ve bu işlemin özetini (hash) kendisi hesaplar (hashHesapla). Bu, tarayıcıdan gelebilecek sahte hash'lere karşı bir güvencedir.
3.	Sunucu, imzaIstek.js modülünü kullanarak bu hash'i Wio Terminal'e gönderir.
4.	Wio Terminal'den imza cevabını bekler.
5.	Gelen imzayı işlem nesnesine ekler ve son bir kez işlemin geçerli olup olmadığını doğrular (islem.gecerliMi()).
6.	Geçerliyse işlemi bekleyen işlemler havuzuna ekler.
4. Değişen Frontend Sorumluluğu (index.html)
Frontend'in rolü basitleştirilmiştir. Artık kriptografik olarak en hassas görevi (imzalama) yapmamaktadır.
•	Görevi: Kullanıcıdan özel anahtarını alıp giriş yapmak (kimlik doğrulama), bakiyesini göstermek ve para transferi için gerekli olan alıcı adresi ve miktarı sunucuya göndermek.
•	Kripto İşlemlerinin Azalması: crypto-js ve elliptic kütüphaneleri hala giriş yapma ve genel anahtarı (public key) özel anahtardan türetme işlemleri için kullanılıyor, ancak işlem imzalama (key.sign) mantığı artık burada mevcut değil. paraGonder fonksiyonu, artık imzalı bir veri değil, ham işlem verisini sunucuya POST eder.
Projenin Genel Çalışma Akışı (Yeni Haliyle)
1.	Başlatma:
o	node kullaniciOlusturma.js ile kullanıcılar ve genesis blok oluşturulur.
o	ardunioKodu.cpp, Wio Terminal'e yüklenir. Cihaz, "Sunucudan hash bekleniyor..." mesajıyla hazır bekler.
o	node server.js ile backend sunucusu başlatılır. Sunucu, Wio Terminal'in bağlı olduğu seri portu dinlemeye hazır olur.
2.	Kullanıcı Etkileşimi:
o	Kullanıcı, tarayıcıda index.html'i açar ve özel anahtarıyla giriş yapar. Bu anahtar sadece kimlik doğrulaması için kullanılır.
o	Kullanıcı, alıcı adresi ve miktarı girerek "Gönder" butonuna tıklar.
3.	İmzalama Süreci:
o	Tarayıcı, işlem detaylarını (imzasız olarak) sunucudaki /api/gonder-imzali uç noktasına gönderir.
o	Sunucu, işlem hash'ini hesaplar ve bu hash'i imzaIstek.js aracılığıyla seri porttan Wio Terminal'e yollar.
o	Wio Terminal'in ekranında "Imzalanacak hash alindi. KEY A'ya basin." mesajı belirir.
o	Kullanıcı, işlemi onaylamak için Wio Terminal üzerindeki A tuşuna fiziksel olarak basar.
o	Wio Terminal, kendi üzerindeki özel anahtar ile hash'i imzalar ve oluşan imzayı JSON formatında seri porttan sunucuya geri gönderir.
o	imzaIstek.js, bu imzayı yakalar ve server.js'e iletir.
4.	Blockchain'e Ekleme:
o	Sunucu, gelen imzayı doğrular ve geçerliyse işlemi bekleyen işlemler listesine ekler.
o	server.js içindeki periyodik madenci, belirli aralıklarla bekleyen işlemleri bir bloğa dahil eder ve blockchain'e ekler.
