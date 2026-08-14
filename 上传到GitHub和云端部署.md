# 只上传 GitHub 的发布方法

最终访问地址：

`https://b1ank-7.github.io/gif-king/`

网站已改为纯浏览器本地转换。GitHub Pages 同时托管页面和浏览器版 FFmpeg，不需要微信云托管，也不需要电脑持续开机。

## 手动上传

1. 打开 GitHub 仓库 `B1ank-7/gif-king`。
2. 点击 `Add file → Upload files`。
3. 解压最新交付包，把其中全部文件拖入上传页面。
4. 如果 GitHub 提示同名文件，将其全部覆盖。
5. 提交说明填写 `Switch to browser-only GIF conversion`。
6. 点击 `Commit changes`。

上传完成后，仓库首页至少应能看到：

- `.github`
- `backend`
- `.gitignore`
- `README.md`

## 检查发布

1. 进入仓库顶部 `Actions`。
2. 等待 `Test and build website` 与 `Deploy GitHub Pages` 都变为绿色对勾。
3. 打开 `https://b1ank-7.github.io/gif-king/`，强制刷新一次。
4. 先用一段 1 至 3 秒的短视频测试。

GitHub Pages 的第一次转换需要下载约 31MB 的本地转换组件。转换期间保持网页打开；视频不会上传服务器。

## 旧云托管

请先确认 GitHub Pages 新版本转换成功，再决定是否停用或删除旧微信云托管服务。停用或删除属于外部状态变更，不要在新网页验证成功前操作。
