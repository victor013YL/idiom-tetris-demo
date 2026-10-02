# 本轮报告：手机试玩反馈修正

日期：2026-10-02。

## 本轮目标

只修正设置暂停、独立音量、手机棋盘边界和奖励显示。Engine、成语数据、奖励映射、粒子逻辑、音色与现有玩法保持原设计。

## 修改文件

- `public/js/app.js`：设置打开/关闭的 UI Freeze、输入清理、重开关闭设置、独立音量控件与持久化、手机水平尺寸预算。
- `public/js/input.js`：对打开的 dialog 保留原生控件键盘操作；跟踪被阻止按键，释放时清理，避免设置关闭后重放。
- `public/js/sound.js`：独立 Music / SFX 音量，统一缩放已有 SFX 增益；0 音量静音；不改变波形、频率、音色合成参数。
- `public/js/storage.js`：兼容旧设置，新增默认音乐 40% 与音效 75%。
- `public/js/reward-overlay.js`：文字 1600ms 与 Freeze 600ms 分离，字号按棋盘宽度 12.5% 计算，四字视觉宽度约 60%～70%；900 字重、描边、轻阴影/余辉。
- `public/index.html`：独立音量滑块、百分比和开关。
- `public/css/game.css`：手机外层 2px 边框、包含边框的尺寸；设置不隐藏 Hold/Next，使用较轻背景和可滚动面板。
- `public/sw.js`：缓存升级 `tetris-v1.5.6-zh-offline-6`，更新静态资源。
- `tests/mobile-feedback.test.mjs`：新增音量、存储、UI 输入、奖励边界、DPR 与边框测试。
- `tests/stone-freeze.test.mjs`：新增实际 App 循环的设置冻结/恢复、Restart、Pause 隔离与奖励文字继续显示测试；调整音量断言。
- `tests/rotate-sound.test.mjs`、`tests/reward-overlay.test.mjs`、`tests/service-worker.test.mjs`：更新受本轮参数影响的断言。
- `tests/manual-feedback.js`：本地验证面板显示设置冻结、两种音量和音乐状态；仅由测试服务器注入，不进入生产 UI。
- `PROJECT_STATUS.md`、`ROUND_REPORT.md`：更新事实与交接。

## 实现与时间

- UI Freeze 独立于 Engine Pause 和 Reward Freeze，音乐继续。打开和所有关闭路径取消键盘重复、虚拟按键和触摸待执行任务。
- 游戏循环持续更新帧时间，UI Freeze 时不执行 Engine tick，并给视觉时钟传入 0；关闭后仅处理当前帧 dt，不补算停留时间。
- Restart 清空两种冻结与奖励，关闭设置，保留保存的音量。
- 音量/开关实时生效并写入 localStorage，点击“关闭”也保留已调声音；其他显示设置仍由“保存”提交。
- 奖励文字：1600ms；前 160ms 淡入并放大，至 1100ms 主要停留，最后 500ms 淡出。
- 强停顿：600ms，恢复后文字仍显示；奖励映射不变。

## 自动测试

命令：`node --test tests/*.test.mjs`。

- 原有：303 项。
- 新增：18 项。
- 总数：321。
- Passed：321。
- Failed：0。
- 跳过/取消：0。
- `git diff --check`：通过。

新增覆盖：设置重力/输入冻结与无补算恢复、Restart 关闭和清空、Pause 状态隔离、设置期间奖励/特效时钟停止、1600ms 显示与 600ms 恢复、音量独立/静音/实际 SFX 增益/持久化、旧存档默认值、非法音量防护、边框独立尺寸、DPR 1/2/3、dialog 原生键与关闭后按键不积压。

## 浏览器验证

使用本地实际 App，加测试控制按钮；浏览器尺寸模拟，非真实手机硬件验收。

- 320/375/390/430px 宽，844px 高：布局完成后四边均为连续 2px，左右均在视口内，无横向溢出。
- 无虚拟按键：320px 棋盘框 x=8～312；375px x=20.5～354.5；390px x=28～362；430px x=48～382。
- 有虚拟按键：四种宽度棋盘底边约 721.5px，按键顶边 739px、底边 836px，互不覆盖。
- 设置打开后，两次间隔观察 y=0、dropTimer=282 保持相同；关闭后正常推进。Hold/Next 仍可见，棋盘背景保留。
- 音乐与音效分别调整，刷新后保存值恢复，滑块显示与实际状态对应；默认值最终恢复为 40% / 75%。
- 单/双/三/四行分别显示万里挑一、全军出击、飞龙在天、势如破竹；字号醒目，奖励在上部、碎块在消行区。
- “冻结乱按”：冻结实测约 611ms，frozenPieceChanged=false；恢复后重力正常，没有积压操作。
- 中途 Restart：奖励为空、freeze=false、Hold 为空、粒子为 0。
- DPR 1 为实际浏览器检查；DPR 2/3 通过自动测试验证位图变化不改变 CSS 棋盘尺寸，未作 DPR 2/3 真机截图验收。

## 发布与试玩

- 正式试玩：https://victor013yl.github.io/idiom-tetris-demo/
- 发布提交：`d9ee8f2adab8e7269f7dcc8965a8ea2d34ccc90e`。
- GitHub Actions：`36974432118`，success。
- 线上首页、App、Input、Sound、Reward、CSS、SW：HTTP 200，内容与本地逐字节一致。
- 本地完整游戏：http://127.0.0.1:8017/
- 本地验证面板：http://127.0.0.1:8020/（单至四行、冻结乱按、中途Restart）。

## 已知问题与下一轮最小建议

- 未连接手机硬件，扬声器上的音乐/SFX 比例、连续操作是否刺耳、Android/Safari 实际边框和触控手感仍待用户手机复测。
- 公开网页浏览器导航超时，线上资源验证成功；不能把资源返回 200 等同于已完成公开站点真机交互测试。
- 本轮不重复完整离线验收；既有缓存/fallback 自动测试继续通过，SW 已升版避免旧资源长期残留。旧标签页可关闭重开并刷新以接收新缓存。
- 下一轮仅根据这版手机反馈微调音量或布局；不自动增加外设、APK 或新玩法。

状态：手机试玩音频、边界、奖励显示与设置暂停问题已修正，等待ChatGPT审核。
