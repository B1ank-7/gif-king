# 没人比我更懂GIF

一个面向手机和电脑浏览器的视频转 GIF 网站。用户只需要完成三件事：上传视频、转换、保存 GIF。

正式网页地址：`https://b1ank-7.github.io/nobody-knows-gif-better/`

## 项目结构

```text
backend/
  public/       网页界面
  src/          Node.js、Express 与 FFmpeg 转换服务
  test/         自动化测试
  Dockerfile    云端运行环境
.github/        GitHub Actions 自动测试
                以及 GitHub Pages 自动发布
render.yaml     Render 云端部署配置
```

## 本地运行

电脑需要 Node.js 20 以上版本和 FFmpeg：

```bash
cd backend
npm install
npm start
```

然后访问 `http://localhost:3000`。

## 通过 GitHub 部署到腾讯云托管

1. 把这个项目推送到 GitHub 仓库的 `main` 分支。
2. 在腾讯云 CloudBase 云托管中新建版本，选择“Git 仓库部署”并绑定该仓库。
3. 分支选择 `main`，目标目录填写 `backend`，Dockerfile 名称填写 `Dockerfile`。
4. 容器端口填写 `3000`，实例数量保持 `1`，然后发布。
5. 部署成功后，直接打开服务的公网域名就是网站。

## 开启 GitHub Pages 手机网址

1. 打开 GitHub 仓库的 `Settings`。
2. 左侧选择 `Pages`。
3. 在 `Build and deployment` 中把 `Source` 选择为 `GitHub Actions`。
4. 打开仓库的 `Actions`，等待 `Deploy GitHub Pages` 显示绿色对勾。
5. 访问 `https://b1ank-7.github.io/nobody-knows-gif-better/`。

GitHub Pages 负责展示网页，腾讯云托管负责执行 FFmpeg 转换。两边都部署完成后，手机访问 GitHub Pages 地址即可完整使用，电脑无需开机。

仓库也保留了 `render.yaml`。如以后改用 Render，可在 Render 新建 Blueprint 并选择同一 GitHub 仓库；首次创建会显示实例费用，请确认后再部署。

## 说明

- 网页不展示帧率、大小、时长等技术参数。
- GIF 转换保留原视频时长，并使用运动插帧改善连续性。
- 生成文件只在服务器临时保存，过期后自动清理。
- 转换任务保存在当前服务实例内，因此部署配置固定为单实例。
