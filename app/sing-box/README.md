# sing-box 原生资源

当前资源已固定为官方 sing-box v1.13.19，并已把三个目标架构的可执行文件放到对应目录：

```text
sing-box/
├── win32-x64/sing-box.exe
├── darwin-x64/sing-box
└── darwin-arm64/sing-box
```

`native-resources.json` 记录了官方 release 资产地址、下载包 SHA-256 和解包后二进制 SHA-256。`validate-native-resources.mjs` 会在打包前复核文件大小、哈希和（macOS）执行权限。

开发者如升级 sing-box，必须同步更新该清单并重新验证。macOS 文件需要保留可执行权限；签名/公证时要把它作为应用内的嵌套代码一起处理。应用不会在核心启动失败时自动降级到直连。
