# 没人比我更懂GIF

一个在手机和电脑浏览器中直接完成视频转 GIF 的网站。视频不会上传服务器，网页与转换程序都由 GitHub Pages 托管。

正式网页地址：`https://b1ank-7.github.io/gif-king/`

## 使用方式

1. 打开网页并选择视频。
2. 保持页面打开，等待设备在本地完成转换。
3. 点击“保存 GIF”。

首次转换会下载约 31MB 的浏览器版 FFmpeg，之后浏览器通常会使用缓存。运动插帧在手机上计算较慢，短视频体验更稳定。

## 项目结构

```text
backend/
  public/       GitHub Pages 网页源代码
  scripts/      构建时复制浏览器版 FFmpeg
  dist/         本地构建结果，不提交 Git
.github/
  workflows/    自动测试、构建和发布 GitHub Pages
```

`backend/src`、`backend/test` 中原来的 Node.js 服务端代码暂时保留作为历史实现，但 GitHub Pages 不会运行或发布它。

## GitHub Pages 自动发布

将项目上传到 GitHub 仓库 `B1ank-7/gif-king` 的 `main` 分支后：

1. 打开仓库的 `Settings → Pages`。
2. `Source` 选择 `GitHub Actions`。
3. 打开 `Actions`，等待 `Deploy GitHub Pages` 显示绿色对勾。
4. 访问 `https://b1ank-7.github.io/gif-king/`。

工作流会安装依赖、构建网页并把 FFmpeg WebAssembly 一起发布，不需要微信云托管、Render 或持续开启电脑 CMD。

## 本地构建

需要 Node.js 24 与 pnpm：

```bash
cd backend
pnpm install
pnpm run build:web
pnpm run preview:web
```

## 产品约束

- 输出格式固定为 GIF。
- 目标使用运动补偿插帧生成 50fps 画面。
- GIF 帧延时会按原视频时长重新分配。
- 输出超过 10MB 时自动降低分辨率和颜色数量。
- 输入最长 30 秒；受浏览器内存和手机性能影响，建议优先使用短视频。
