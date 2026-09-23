# A.R.I — Persönlicher KI-Assistent

A.R.I läuft als Command Center auf dem PC und als eigenständige App auf dem Handy. Beide synchronisieren sich automatisch (Gehirn, Einstellungen, KI-Schlüssel).

## 🖥️ Für den PC

1. **[ari-pc.zip herunterladen](https://kingshadow1332.github.io/app/pc/ari-pc.zip)**
2. Entpacken (z. B. auf den Desktop)
3. `START-ARI.bat` doppelklicken

A.R.I sucht beim Start selbst nach neueren Versionen und bietet ein Update per Klick an — nichts hier manuell nachziehen.

## 🐧 Für Linux (Ubuntu/Debian, X11) — ⚠️ ungetestet

1. **[ari-pc.zip herunterladen](https://kingshadow1332.github.io/app/pc/ari-pc.zip)** und entpacken
2. Im Terminal im entpackten Ordner: `bash linux/install.sh`
3. Fertig — „A.R.I Assistant“ steht im Programmmenü (und optional auf dem Desktop, mit Icon)

Die Linux-Version wurde noch nicht auf echtem Linux getestet und kann Fehler enthalten. Der Installer richtet Python-Umgebung, benötigte Pakete (xdotool, wmctrl, playerctl …), Starter und auf Wunsch Autostart ein. Optionen: `--with-piper` (lokale Stimme), `--autostart`, `--dir`, `--uninstall`.
Unter **Wayland** sind Tasten-/Maussteuerung und Bildschirm-Ansicht eingeschränkt — beim Login „Ubuntu on Xorg“ wählen.

## 📱 Fürs Handy (Android)

1. **[ARI.apk herunterladen](https://kingshadow1332.github.io/app/ARI.apk)**
2. Datei öffnen und installieren (Android fragt einmal nach Erlaubnis für „Unbekannte Apps“ bzw. blockiert es kurz über den Play-Protect-Schutz — dort „Trotzdem installieren“ wählen)
3. App öffnen, mit dem PC koppeln (QR-Code am PC unter Einstellungen → HANDY)

Die App läuft auch **ohne PC** eigenständig (eigener KI-Schlüssel in den Einstellungen).

## Aktueller Stand

| | Version | Download |
|---|---|---|
| PC | 1.2.1 | [ari-pc.zip](https://kingshadow1332.github.io/app/pc/ari-pc.zip) |
| Handy | 1.4.1 | [ARI.apk](https://kingshadow1332.github.io/app/ARI.apk) |

Beide Programme aktualisieren sich danach selbst über diese Seite.
