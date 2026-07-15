# 3D modeller

`urun.html` atlıkarıncası `*.min.glb` dosyalarını kullanır (meshopt sıkıştırmalı,
dokular WebP). `*.glb` orijinaller kaynak olarak duruyor; siteden referans edilmez.

Yeni/güncellenen bir modeli yayına hazırlamak için:

```bash
npx -y @gltf-transform/cli optimize models/<ad>.glb models/<ad>.min.glb --compress meshopt --texture-compress webp
```

Sonuç bu test modellerinde 21 MB → ~2,6 MB, görsel fark yok denecek düzeyde
(simplify hata payı 0,0001). Meshopt seçilme nedeni: çözücüsü three.js addons
ile geliyor (`three/addons/libs/meshopt_decoder.module.js`), Draco gibi ayrı
WASM yolu ayarı gerektirmiyor. GLTFLoader tarafında `setMeshoptDecoder` çağrısı
şart — `urun.html` içinde hazır.
