$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    throw "找不到 Python，请先安装 Python 3.10 或更高版本。"
}
$python = $pythonCommand.Source

& $python -m PyInstaller --version
if ($LASTEXITCODE -ne 0) {
    throw "当前 Python 没有安装 PyInstaller，请运行：python -m pip install pyinstaller"
}

$basePrefix = (& $python -c "import sys; print(sys.base_prefix)").Trim()
$tclSource = Join-Path $basePrefix "tcl"
$tclDir = Join-Path $tclSource "tcl8.6"
$tkDir = Join-Path $tclSource "tk8.6"
if (-not (Test-Path -LiteralPath (Join-Path $tclDir "init.tcl")) -or -not (Test-Path -LiteralPath (Join-Path $tkDir "tk.tcl"))) {
    throw "找不到 Tcl/Tk 运行文件，请改用 python.org 的 Windows Python 安装包，并安装 Tcl/Tk 组件。"
}

$stage = Join-Path $projectRoot ".tk-bundle"
$oldTclLibrary = $env:TCL_LIBRARY
$oldTkLibrary = $env:TK_LIBRARY
try {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $stage | Out-Null
    Copy-Item -LiteralPath $tclDir -Destination $stage -Recurse
    Copy-Item -LiteralPath $tkDir -Destination $stage -Recurse
    $env:TCL_LIBRARY = Join-Path $stage "tcl8.6"
    $env:TK_LIBRARY = Join-Path $stage "tk8.6"

    & $python -m PyInstaller --noconfirm --clean --onefile --windowed --name ModelImageSorter (Join-Path $projectRoot "model_image_sorter.py")
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller 构建失败，退出码：$LASTEXITCODE"
    }
    Write-Host "构建完成：$(Join-Path $projectRoot 'dist\ModelImageSorter.exe')" -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    if ($null -eq $oldTclLibrary) {
        Remove-Item Env:TCL_LIBRARY -ErrorAction SilentlyContinue
    } else {
        $env:TCL_LIBRARY = $oldTclLibrary
    }
    if ($null -eq $oldTkLibrary) {
        Remove-Item Env:TK_LIBRARY -ErrorAction SilentlyContinue
    } else {
        $env:TK_LIBRARY = $oldTkLibrary
    }
}
