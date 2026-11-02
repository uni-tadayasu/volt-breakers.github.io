# AGENTS.md

## Project summary and core loop
今回作る内容です。ステージは横スクロール、キャラクターと敵は実際の3Dモデルを使う、ロックマンX風のアクションです。

- **ソロ**：キャラ選択（バスターの「ヴァン」／セイバーの「レイ」）→ オープニング映像 → チュートリアル付きのオープニングステージとボス → 8ボスのステージセレクト → 最終4ステージ（合体隠しボス／門番／8ボス再戦／2段階変身する最終ボス）→ エンディング
- **アクション**：ダッシュ、壁ずり落ち、壁蹴り、チャージショット3段階、セイバー3連撃とセイバーウェーブ、ボスから得る特殊武器8種と弱点の連鎖
- **アイテム**：回復（小・大）、武器エネルギー、1UP、E缶（ストック）。パスワードで続きから遊べます
- **オンライン**：協力2人、対戦2人、対戦4人。キャラは重複できず、対戦では全ボスも選べます。運営キーがあれば侵入ボスとして他プレイヤーのステージに乱入できます
- 手作り風のUI、PC／スマホ両対応のタッチ操作、生成した音楽と映像

## How to play / controls
See the closing chat message.
Controls: Documented in the game code.

## Important files
- `/index.html` — entry point: importmap, canvas/DOM shell, script bootstrap
- `/rosebud-game-defaults.css` — project file
- `/rosebud-game-defaults.js` — game module
- `/rosie/README.md` — Rosie pre-built helper module
- `/rosie/roseblox.js` — Rosie pre-built helper module
- `/instant_db_config.js` — InstantDB multiplayer configuration
- `/instant_db.md` — project notes
- `/art_direction.md` — visual direction used for generated art
- `/sound_direction.md` — audio direction used for generated sound
- `/data.js` — game module
- `/input.js` — game module
- `/audio.js` — audio playback helpers
- `/net.js` — game module
- `/assets.js` — game module

## Assets and audio
Images: `assets/bg-city.webp`, `assets/bg-fortress.webp`, `assets/ending-scene.webp`, `assets/icon-1up.webp`, `assets/icon-energy.webp`, `assets/icon-etank.webp`, `assets/icon-health-large.webp`, `assets/icon-health-small.webp`, `assets/opening-scene.webp`, `assets/portrait-boomer.webp`, `assets/portrait-crimson.webp`, `assets/portrait-frost.webp`, `assets/portrait-guardian.webp`, `assets/portrait-laser.webp`, `assets/portrait-overlord.webp`, `assets/portrait-quake.webp`, `assets/portrait-rei.webp`, `assets/portrait-scorpio.webp`, `assets/portrait-shadow.webp`, `assets/portrait-spark.webp`, `assets/portrait-storm.webp`, `assets/portrait-van.webp`, `assets/portrait-vile.webp`, `assets/portrait-void.webp`, `assets/portrait-volca.webp`, `assets/tile-metal-floor.webp`, `assets/tile-tech-wall.webp`, `assets/title-bg.webp`
Models: `assets/models/enemy-walker.glb`, `assets/models/hero-azure.glb`, `assets/models/hero-crimson.glb`, `assets/models/overlord.glb`
Audio: `assets/audio/buster-shot.mp3`, `assets/audio/explosion.mp3`, `assets/audio/stage-theme.mp3`
Sound direction: - Music: very cool, high-energy rock/synth hybrid (driving drums, distorted guitar riff, arpeggiated synth), loopable 15s; boss fights replay faster. - SFX (generated): buster shot, big explosion.
Playback note: reference media as `assets/...`; browsers start audio only after the first user gesture.

## Notes for future edits
None recorded.

## Final validation status
No verification result was recorded.
Finished from the model's closing message (no `finish` call).
