# 媒体预览工具

工作台只在用户点击“转为 MP4 兼容播放”时调用 FFmpeg。原始素材下载不会经过转码，转码输出写入系统临时目录并使用随机内容哈希命名。

- Windows x64：`win32-x64/ffmpeg.exe`，SHA-256：`228d7a8556258de907fdb55f36850078ebc7680b84ec30d84ea02e99bec1d1eb`
- macOS Intel / Apple Silicon：随工程提供 `darwin-x64/ffmpeg` 和 `darwin-arm64/ffmpeg`，构建脚本会按固定的 FFmpeg Static `b6.1.1` 发布资源校验并在缺失时下载；SHA-256 分别为 `ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894`、`a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584`。应用仍保留设置路径和系统 `PATH` 作为兜底。
- macOS 构建来源：`https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64.gz`、`https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz`。发布时必须一并保留 GPL/LGPL 及各编解码器的许可证义务。
- FFmpeg 的许可证与源代码义务见 `licenses/ffmpeg-gpl.txt`。发布前必须保留许可证并确认所使用构建的再分发条款。

转换命令只生成兼容预览文件：H.264、AAC、fast-start MP4；不包含 DRM 解密、去水印或权限绕过。
