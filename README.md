# Rota Defteri — Uzun Yol ve Tatil Rota Planlayıcı

Kişisel kullanım için hazırlanmış, mobil öncelikli bir uzun yol / tatil rota planlama
web uygulaması (PWA). Ana ekrandan navigasyon yapmaz; bunun yerine rotayı, molaları,
yol üzerindeki mekânları, hava durumunu, yakıt maliyetini ve tahmini varış saatini
tek ekranda planlar, ardından hazır rotayı Google Maps / Waze gibi uygulamalara aktarır.

## Bu prototipte çalışan özellikler (Aşama 1 — İlk Çıktı)

1. Ana sayfa (yaklaşan yolculuk kartı, kayıtlı yolculuklar)
2. Yeni yolculuk oluşturma formu
3. Başlangıç / varış seçimi (adres yazarak veya mevcut konum ile)
4. Harita üzerinde gerçek rota çizimi (Leaflet + OpenStreetMap)
5. Gerçek mesafe ve sürüş süresi (OSRM)
6. Otomatik + manuel mola ekleme/silme
7. Mola dahil tahmini varış saati (canlı yeniden hesaplama)
8. Rota üzerindeki mekân kartları (Overpass API — restoran, kafe, akaryakıt, fast food)
9. Mekânı rotaya ekleme (süreyi otomatik günceller)
10. Google Maps ve Waze'de açma
11. Yolculuğu kaydetme (localStorage)
12. Mobil alt menü + masaüstü yan menü
13. Sayfa yenilendiğinde kayıtların korunması

Ayrıca: hava durumu (Open-Meteo), favoriler, ayarlar, JSON dışa aktarma,
temel PWA desteği (manifest + service worker + çevrimdışı kabuk).

## Kullanılan ücretsiz servisler

| İhtiyaç      | Servis                  | Anahtar gerekir mi? |
|--------------|--------------------------|----------------------|
| Adres arama  | Nominatim (OSM)          | Hayır |
| Rota/mesafe  | OSRM demo sunucusu       | Hayır |
| Hava durumu  | Open-Meteo               | Hayır |
| Mekân verisi | Overpass API (OSM)       | Hayır |
| Harita karoları | OpenStreetMap tile sunucusu | Hayır |

**Önemli:** OSRM demo sunucusu (`router.project-osrm.org`) ve Overpass API halka açık,
ücretsiz ama kotalı/yoğun kullanımda yavaşlayabilen servislerdir. Kişisel kullanım için
uygundur; yoğun/ticari kullanımda kendi OSRM veya Overpass sunucunuzu kurmanız ya da
`.env.example` içindeki ücretli alternatiflere (OpenRouteService, Google Places vb.)
geçmeniz önerilir. Bu prototipte hiçbir ücretli servis zorunlu değildir.

## Çalıştırma

Bu saf HTML/CSS/JS bir uygulamadır, derleme adımı gerekmez.

```bash
# Basit bir yerel sunucu ile çalıştırın (fetch/CORS ve service worker için gereklidir)
npx serve .
# veya
python3 -m http.server 8080
```

Sonra tarayıcıda `http://localhost:8080` adresini açın. Mobilde "Ana Ekrana Ekle"
seçeneğiyle PWA olarak yükleyebilirsiniz.

> index.html dosyasını doğrudan `file://` ile açmak service worker ve bazı fetch
> isteklerinin çalışmamasına yol açabilir — mutlaka bir yerel sunucu kullanın.

## Dosya yapısı

```
rota-planlayici/
├── index.html       Uygulama iskeleti, tüm ekranlar
├── style.css         Koyu lacivert / turuncu vurgulu, kart tabanlı tasarım
├── app.js            Tüm uygulama mantığı (rota, mola, mekân, hava, kayıt)
├── manifest.json      PWA manifesti
├── sw.js              Service worker (temel çevrimdışı kabuk önbelleği)
└── .env.example       Opsiyonel, ücretli servis anahtarları için şablon
```

## Bilinen sınırlar (bu ilk prototipte henüz yok)

- Alternatif rotalar (en hızlı / en kısa / manzaralı vb.) — tek rota hesaplanıyor
- Trafik gecikmesi, yol çalışması ve kapanma verileri
- Feribot / köprü / tünel geçiş ücretleri
- Yolculuk Modu (büyük düğmeli sürüş ekranı)
- Bildirimler
- Yolculuk öncesi kontrol listesi
- Çoklu araç profili yönetimi

Bunlar spesifikasyondaki 2–10. aşamalara karşılık geliyor; bu prototip üzerine
sırayla eklenebilir. Devam etmemi isterseniz hangi aşamadan başlamamı istediğinizi
söylemeniz yeterli — örneğin "alternatif rotalar" veya "yolculuk modu".
