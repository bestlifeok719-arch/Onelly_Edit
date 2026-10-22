# Onelly Edit: Android + iPhone app

Faayilli `www/index.html` = editor guutuu (web). Capacitor fayyadamuun app Android fi iPhone ta'e.

## Android APK (salphaa)
1. github.com irratti repository haaraa uumi (fakkeenyaaf `onelly-edit`).
2. Faayila foldara kanaa hunda (`www`, `.github`, `package.json`, `capacitor.config.json`) olkaa'i.
3. GitHub → **Actions** → "Build Android APK" → **Run workflow**.
4. Daqiiqaa ~5 booda, gadi buufadhu: **Artifacts → onelly-edit-apk** (app-debug.apk).
5. Bilbila Android irratti install godhi ("Install unknown apps" eeyyamuu qabda).

## iPhone
- "Build iOS" workflow simulator qofaaf dha (Mac irratti).
- iPhone dhugaa irratti install gochuuf **Apple Developer account** ($99/waggaa) fi Xcode/TestFlight barbaachisa.
- Dursa karaa salphaa: Safari irratti web editor banii **Share → Add to Home Screen**.

## Fooyya'insa itti aanu
`www/index.html` bakka haaraa kanaan bakka buusi, GitHub irratti commit godhi, APK haaraa ofumaan ni ijaarama.


## Ibsa guutuu
Ibsa guutuu (dandeettiiwwan, Fast Export, daangaa, karoora) `README.txt` keessatti argama.

## ⚡ Native Fast Export (Android APK)
`native/OnellyExport.java` = hardware decode + hardware encode (Media3 Transformer). Yeroo viidiyoo irra saffisaa dha.
Workflow ofumaan `native/` gara android project keessatti kaa'a. Browser/iPhone irratti Standard export akkuma duraanii hafa.
Hin deeggaramne (yeroo ammaa): music tracks, transitions, LUT, mask, Ken Burns, blur/vignette/grain, text animation, video overlay.

## ⚡ Turbo Export (web / Chrome, APK hin barbaachisu)
`www/turbo-export.js`: mp4box -> VideoDecoder (hardware) -> canvas (koodii Standard wal-fakkaatu) -> VideoEncoder (hardware) -> MP4.
Taphachiisuu hin barbaachisu, kanaaf yeroo viidiyoo irra saffisaa ta'a. Hin milkoofne yoo ta'e sababni isaa mul'ata, ergasii Standard filachuu ni dandeessa.
GitHub Pages irratti `www/` hunda olkaa'i (index.html + bridge.js + native-export.js + turbo-export.js).
