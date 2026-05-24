# 班級管理 Classroom Hub

這是一個可直接放到 GitHub Pages 的靜態班級管理工具。主要資料仍會先保存在瀏覽器本機端，按下「儲存」時會壓縮班級資料並上傳到 Firebase Firestore；按下「載入」時會從 Firebase 讀回同一份壓縮資料。

## 上傳到 GitHub Pages

1. 將這個資料夾內的檔案上傳到 GitHub repository。
2. 到 repository 的 `Settings > Pages`。
3. Source 選擇要發布的 branch，例如 `main`，資料夾選 `/root`。
4. 發布後，請把 GitHub Pages 網址加入 Firebase Authentication 的 Authorized domains。

## Firebase 必要設定

1. Firebase Console 開啟專案 `classroom-hub-bb1dc`。
2. Authentication 啟用 `Google` 登入。
3. Firestore Database 建立資料庫。
4. 將 `firestore.rules` 貼到 Firestore Rules 並發布。

## 雲端資料路徑

每位登入老師只會讀寫自己的文件：

```text
users/{uid}/classManager/main
```

資料會以 gzip base64 壓縮後存入 `payload.data`，避免 Firestore 文件快速膨脹。前端仍限制每天儲存 3 次，避免誤按造成頻繁覆蓋。

## 本機備份

即使沒有 Firebase，工具仍可使用本機儲存與匯出 JSON 備份。正式使用前，建議老師定期在「設定」內匯出本機資料。
