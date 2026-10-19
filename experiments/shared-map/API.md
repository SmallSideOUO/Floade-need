# 共用地圖 AI API

啟動地圖視窗後，資料目錄的 `api-runtime.json` 提供本次啟動的 loopback endpoint 與 token。Windows 預設為 `%USERPROFILE%\.floade\work-map`，以下 `data/` 都指這個目錄；client 自動找到它。只監聽 `127.0.0.1`，每次啟動換 token，不接受瀏覽器 Origin。token 不要貼進對話或提交到 Git。Work Map 可從 Floade 面板開啟，仍使用獨立視窗與 API。

推薦使用本機 client，不需要手動處理 token：

```powershell
node experiments/shared-map/client.cjs describe
node experiments/shared-map/client.cjs graph
node experiments/shared-map/client.cjs apply request.json
node experiments/shared-map/client.cjs history
node experiments/shared-map/client.cjs screenshot region.json result.png
```

獨立測試資料可加 `--profile=<絕對目錄>`。視窗關閉後 API 也關閉。所有 HTTP 呼叫須帶 `Authorization: Bearer <token>`；POST 使用 JSON。畫布操作未保存時先保存，使用者正在拖曳時回傳 409，稍後重新讀取再試。

`GET /v1/describe` 回傳能力和欄位。`GET /v1/graph` 回傳目前 AI 可讀的圖與 `revision`。隱藏物件不出現；隱藏文字以 `textWithheld: true` 標示。只能調整後者的幾何、外觀，不能覆寫其文字。API 不提供改變隱私設定的能力。

`POST /v1/changes` 原子套用一批最多 100 個操作；任一操作不合法就整批拒絕。`expectedRevision` 使用剛取得的版本，版本過期回傳 409。重試同一請求必須使用完全相同的 body 和 `requestId`，不會重複修改或留下第二筆紀錄。同一 ID 配不同 body 會被拒絕。

```json
{
  "requestId": "unique-request-id",
  "expectedRevision": 12,
  "actor": "Codex",
  "reason": "讓兩個分支的連線避開中間物件",
  "operations": [
    {"op":"node.update","id":"node-id","patch":{"parentId":"parent-id","background":"#17171b"}},
    {"op":"edge.update","id":"edge-id","patch":{"color":"#64768d","width":1.5}}
  ]
}
```

Work Map 嚴格使用樹狀圖。`graph.treeMode` 為 true，`rootId` 是唯一根；隱私過濾可能遮蔽根或上層，因此可讀版本不一定包含完整的樹，不能把看不到的父層當成不存在。舊圖首次開啟會以加密紀錄記下 `tree.enable` 轉換前後的圖。

操作包含 `tree.enable`、`node.create/update/delete`、`edge.update`。每個操作自帶 caller 指定的 `id`；`tree.enable` 可使用 `strict-tree`。新增根只在空圖時允許；其他 `node.create` 的 `parentId` 指向可讀上層，省略時接到可讀根。父線自動建立，不要再建立第二條線；重新 GET 圖取得該線 id，才能編輯它的文字與外觀。

改上層使用 `node.update` 的 `parentId`；改同層順序使用數字 `order`（小的在左）。循環、多父層、非根沒有上層等變更會整批拒絕。刪中間節點會把其子節點接到原上層，仍有子節點的根不可刪除；涉及不可讀物件的個別操作仍拒絕。所有結構變更及大小變更後會重新分層，`x/y` 由程式決定，不能靠座標打破樹狀排列。修改上層會清空原父線文字，避免把舊關係描述直接套到新上層。

物件欄位：`title`、`note`、`mark`、`parentId`、`order`、`x/y`、`width/height`、`shape`、`background`、`textColor`、`opacity`。`order` 範圍 ±100000，大小 70..600 / 50..500，不透明度 0..1，顏色 `#RRGGBB`。所有幾何都是世界座標，x 是中心、y 是上緣；寫入的 x/y 仍會由樹狀排列重算。

樹狀線條可更新 `label`、`color`、`width`（0.5..12）、`lineStyle`（solid/dashed）。`from` 為上層、`to` 為子節點，修改 from 等同改該子的上層；不能改 to 或單獨刪除父線。線條固定從父節點底部、經同一個水平分支、接到子節點頂部。

樹狀模式不接受 `routing`、`controlPoints`、`waypoints`、port、曲率或偏移等自由路徑修改。舊線上保留的路徑參數不參與樹狀繪製。關係文字保留在 API 與編輯面板，畫布及 API 截圖以清楚的上下結構呈現，不在分支線上鋪字。

`GET /v1/history?limit=50&before=<record-id>` 回傳最新到最舊的紀錄與 `nextCursor`。每筆包含時間、操作者、原因、前後版本、狀態及受影響物件／線的 before/after 屬性。API 套用前先寫入加密紀錄，關閉後仍保存於 `data/ai-history/*.private`；啟動會恢復中斷狀態。紀錄不會因物件刪除而刪除，沒有清除 API。查詢紀錄同樣依目前隱私過濾；涉及被遮蔽內容的原因也遮蔽。請勿自行解密私人紀錄。

`POST /v1/screenshot` 回傳 PNG。可指定世界座標區域，或 `nodeIds` 讓程式自動包住那些物件。`scale` 0.1..3，輸出最大 4096 × 4096；Header 包含 `X-Map-Revision` 與 `X-Map-Region`。

```json
{"region":{"x":-300,"y":400,"width":1400,"height":900},"scale":1}
```

截圖使用與畫布相同的路由、形狀和外觀，先產生 AI 可讀的獨立畫面，再裁到區域；不會捕捉私人編輯面板。隱藏文字被遮蔽，隱藏物件和相關線被排除。這是供 AI 檢查的圖；畫面隱私與 AI 隱私仍獨立，因此可能和你當時開啟的視覺遮蔽不同。

截圖實作使用 Electron 的 [offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering) 與 [capturePage](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts)，固定區域大小，避免隱藏視窗被 Windows 螢幕尺寸裁掉。
