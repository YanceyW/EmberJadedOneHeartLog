# 炎都拾光

给两个人用的微信小程序。现在能用的是：微信登录、互相确认对象、女性经期和排卵推算、纪念日、生日、小日程、首页天气，以及按生日生成的今日建议。相册、足迹等入口还在「以后」里，点进去是施工中。

不发布正式版。只有管理员、项目成员和体验成员能打开体验版。

## 打开之前

1. 用微信开发者工具打开本目录。云环境 ID 在本机的 `miniprogram/app.js` 里配置，不要写进 README 或其它公开文档。
2. 在 `cloudfunctions` 上右键，先选云环境，再在 `api` 上选择「创建并部署：云端安装依赖（不上传 node_modules）」。
3. DeepSeek 密钥和和风天气放在 `cloudfunctions/api/secret.js`。和风要填 API Host，以及 `QWEATHER_PRIVATE_KEY`（和已保存公钥成对的私钥全文，多行时用反引号包住）。这个文件已在 `.gitignore`，不进 Git。改完云函数后要重新部署，手机上才会生效。
4. 云数据库集合会在云函数第一次成功调用后出现：`users`、`periods`、`anniversaries`、`birthdays`、`schedules`、`readings`、`asks`、`almanacs`、`memories`、`notes`。权限选「仅管理端可读写」。改完云函数后要重新部署。
5. 体验版在 mp.weixin.qq.com 的「管理 → 版本管理」里选择。体验二维码大约 7 天过期，过期后重新生成，不用重新选体验版。
6. 位置只用于查天气。隐私指引里要声明位置信息并填写用途。没有定位时，首页可以手选城市。

## 文件是干什么的

- `miniprogram/app.js`：启动云开发，并用 `call` 调用云函数。
- `miniprogram/app.json`：页面名单、导航颜色、位置隐私声明。
- `miniprogram/app.wxss`：单独打开的页面用的底色、卡片和按钮。嵌在首页里的三个面板要用自己的样式。
- `miniprogram/pages/main`：底部标签所在的滑动页。左右滑在首页、日历、聊天、记录、我之间切换。页面底色是原来的暖白色，天气动画只画在首页的天气卡片里。
- `miniprogram/pages/home`：问候、对方留下的一句话、天气卡片、今日建议、最近一项安排。天气卡片顶部是一块小天空，晴、多云、风、雨、雪、雾、雷雨和晚上都在这块里。长按温度可以预览。今日建议超过 1 小时才重新生成。
- `miniprogram/pages/calendar`：月历、农历、事项图标、今年的黄历宜忌，以及临近安排。黄历在手机上计算，不请求模型。
- `miniprogram/pages/records`：纪念日、生日、经期、日程放在一页，可以筛选类型，按日期或类型排序。
- `miniprogram/pages/mine`：昵称、对象状态，以及编辑资料、权限和以后的入口。
- `miniprogram/pages/profile`：昵称、性别、对象和称呼、经期提醒、周期，以及阳历或农历生日、时辰、出生地。
- `miniprogram/pages/partner`：选择或取消对象。双方都确认后才互相看见。
- `miniprogram/pages/settings`：权限页，里面是位置权限。
- `miniprogram/pages/ask`：AI 聊天面板（嵌在主页 swiper 中间）。按文字量显示以往对话，右上角可以改记忆，也可以多选删除聊天记录。
- `miniprogram/pages/soon`：还没做的功能，只显示施工中。
- `miniprogram/utils/date.js`：日期加减和纪念日在闰年的处理。
- `miniprogram/utils/birthday.js`：计算现在多少岁，以及距离下一次生日还有几天。阳历和农历都可以。
- `miniprogram/utils/cycle.js`：经期、排卵和易孕期的推算。
- `miniprogram/utils/filter.js`：月历筛选记在本机，按微信账号分开。
- `miniprogram/utils/lunar.js`：生日滚轮和月历农历。换算用 `utils/lunar-lib.js`（lunar-javascript 1.7.8，MIT）。
- `miniprogram/utils/almanac.js`：只计算今年每一天的宜和忌。
- `cloudfunctions/api/index.js`：唯一的云函数。按 `action` 处理登录、资料、对象、经期、纪念日、日程、天气、今日建议、留言和追问。
- `cloudfunctions/api/secret.js`：DeepSeek 密钥和和风天气密钥，只留在本机和云端。

经期记在女性名下。双方互为对象后，男方的月历上能看到，也能修改。纪念日和日程默认双方可见，也可以改成仅自己可见。
