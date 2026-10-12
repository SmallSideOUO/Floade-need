# 共用地圖 AI API

啟動地圖視窗後，`data/api-runtime.json` 提供本次啟動的 loopback endpoint 與 token。只監聽 `127.0.0.1`，每次啟動換 token，不接受瀏覽器 Origin。token 不要貼進對話或提交到 Git。實驗功能仍獨立於 need 主體。

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
    {"op":"node.update","id":"node-id","patch":{"x":400,"y":500,"background":"#17171b"}},
    {"op":"edge.update","id":"edge-id","patch":{"routing":"curve","fromPort":"bottom","toPort":"top","curvature":0.5,"offset":40,"color":"#64768d","width":1.5}}
  ]
}
```

操作包含 `node.create/update/delete`、`edge.create/update/delete`。create 自帶 caller 指定的唯一 `id`；建立線須指定 `from` 和 `to`。每兩個物件只允許一條連線。所有幾何使用畫布世界座標：物件 `x` 是中心、`y` 是上緣；不是螢幕座標。刪物件會刪相關線，刪既有上層線會清除對應 parentId。

物件欄位：`title`、`note`、`mark`、`x/y`、`width/height`、`shape`、`background`、`textColor`、`opacity`。位置範圍 ±100000，大小 70..600 / 50..500，不透明度 0..1，顏色 `#RRGGBB`。

線條欄位：`label`、`from/to`、`color`、`width`（0.5..12）、`lineStyle`（solid/dashed）、`routing`（curve/rounded）、`fromPort/toPort`（auto/top/right/bottom/left）、`curvature`（0..1）、`offset`（±1000）、`cornerRadius`（0..300）。

`controlPoints` 是兩個絕對座標 `{x,y}`，分別作為 cubic Bézier 的兩個控制點，可用來真正畫出任意弧度；建議同時固定兩端 port。`waypoints` 是最多 12 個途經點，以帶圓角的折線依序連接。設為 `null` 可清除。自訂路徑優先於自動避障；AI 需用截圖檢查效果。自動路由比較接點、路徑長度、物件碰撞和已有線路的接近程度，擁擠時可能仍交叉。

`GET /v1/history?limit=50&before=<record-id>` 回傳最新到最舊的紀錄與 `nextCursor`。每筆包含時間、操作者、原因、前後版本、狀態及受影響物件／線的 before/after 屬性。API 套用前先寫入加密紀錄，關閉後仍保存於 `data/ai-history/*.private`；啟動會恢復中斷狀態。紀錄不會因物件刪除而刪除，沒有清除 API。查詢紀錄同樣依目前隱私過濾；涉及被遮蔽內容的原因也遮蔽。請勿自行解密私人紀錄。

`POST /v1/screenshot` 回傳 PNG。可指定世界座標區域，或 `nodeIds` 讓程式自動包住那些物件。`scale` 0.1..3，輸出最大 4096 × 4096；Header 包含 `X-Map-Revision` 與 `X-Map-Region`。

```json
{"region":{"x":-300,"y":400,"width":1400,"height":900},"scale":1}
```

截圖使用與畫布相同的路由、形狀和外觀，先產生 AI 可讀的獨立畫面，再裁到區域；不會捕捉私人編輯面板。隱藏文字被遮蔽，隱藏物件和相關線被排除。這是供 AI 檢查的圖；畫面隱私與 AI 隱私仍獨立，因此可能和你當時開啟的視覺遮蔽不同。

截圖實作使用 Electron 的 [offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering) 與 [capturePage](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts)，固定區域大小，避免隱藏視窗被 Windows 螢幕尺寸裁掉。
