# 模特图 ID 分类器

`model_image_sorter.py` 是一个只使用 Python 标准库的 Windows 图形小工具。它适合把一批按 ID 命名的图片，例如 `1234567.png`、`1234568.jpg`，按清单移动到另一个文件夹。

## 启动

在项目根目录打开 PowerShell：

```powershell
python .\model_image_sorter.py
```

也可以直接双击 `.py` 文件（前提是系统已经关联 Python）。

程序使用 Python 自带的 Tkinter，不需要额外安装第三方库。若提示缺少 `init.tcl` 或 Tcl/Tk，请改用 python.org 的 Windows Python 安装包，并确保安装了 Tcl/Tk 组件。

## 重新打包 EXE

在项目根目录打开 PowerShell，运行：

```powershell
.\build_model_image_sorter.ps1
```

生成的单文件程序位于 `dist\ModelImageSorter.exe`，目标电脑不需要安装 Python。

## 使用步骤

1. 选择“图片来源文件夹”。默认扫描该目录的第一层；需要扫描子目录时勾选“递归扫描”。
2. 在 ID 清单中粘贴 ID，每行一个。也支持直接粘贴带扩展名的文件名，例如 `1234567.png`。
3. 选择“输出文件夹”，点击“扫描匹配”。
4. 在右侧确认匹配预览，确认无误后点击“确认移动”。

工具只按完整文件名（去掉扩展名）精确匹配，不会用“包含 ID”的模糊匹配。目标文件夹中的同名文件会跳过，不会覆盖；移动结果会在目标目录写入一份日志。成功移动后可使用“撤销上次移动”将文件移回原位置。

支持的图片扩展名：PNG、JPG/JPEG、WEBP、GIF、BMP、TIF/TIFF、JFIF、AVIF、HEIC。
