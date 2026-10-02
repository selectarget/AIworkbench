"""模特图 ID 分类器

按文件名（不含扩展名）精确匹配 ID，并在确认后把图片移动到目标目录。
仅使用 Python 标准库，Windows 直接运行即可。
"""

from __future__ import annotations

import re
import shutil
import sys
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from tkinter import BooleanVar, END, NORMAL, DISABLED, StringVar, Text, TclError, Tk, filedialog, messagebox
from tkinter import ttk


IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".tif",
    ".tiff",
    ".jfif",
    ".avif",
    ".heic",
}
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


@dataclass
class PlanItem:
    """一个 ID 在扫描后的移动计划。"""

    identifier: str
    matches: list[Path] = field(default_factory=list)
    movable: list[Path] = field(default_factory=list)
    conflicts: list[Path] = field(default_factory=list)
    status: str = "未找到"


def _inside(path: Path, parent: Path) -> bool:
    """判断 path 是否位于 parent 内，兼容尚不存在的目标目录。"""

    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _normalize_id(token: str) -> tuple[str | None, str | None]:
    """清理一个粘贴值，返回 (标准 ID, 错误原因)。"""

    value = token.strip().strip("\"'").strip()
    if not value:
        return None, None

    # 用户有时会把完整文件名一起粘贴进来，允许去掉常见图片扩展名。
    suffix = Path(value).suffix.casefold()
    if suffix in IMAGE_EXTENSIONS:
        value = value[: -len(suffix)]

    if "/" in value or "\\" in value:
        return None, f"包含路径分隔符：{token.strip()}"
    if not ID_PATTERN.fullmatch(value):
        return None, f"ID 格式不支持：{token.strip()}"
    return value, None


def parse_ids(raw: str) -> tuple[list[str], list[str]]:
    """解析每行一个 ID，同时兼容逗号、分号或空格分隔的粘贴内容。"""

    identifiers: list[str] = []
    invalid: list[str] = []
    seen: set[str] = set()
    for line in raw.splitlines():
        for token in re.split(r"[,，;；\t ]+", line):
            identifier, error = _normalize_id(token)
            if error:
                invalid.append(error)
                continue
            if identifier is None:
                continue
            key = identifier.casefold()
            if key in seen:
                continue
            seen.add(key)
            identifiers.append(identifier)
    return identifiers, invalid


def scan_image_files(source: Path, destination: Path, recursive: bool) -> dict[str, list[Path]]:
    """建立 stem -> 文件列表索引，严格限制在图片扩展名内。"""

    paths = source.rglob("*") if recursive else source.iterdir()
    index: dict[str, list[Path]] = {}
    for path in paths:
        if not path.is_file() or path.suffix.casefold() not in IMAGE_EXTENSIONS:
            continue
        # 目标目录若位于来源目录内，不把已经分类的文件再次加入来源索引。
        if destination.exists() and _inside(path, destination):
            continue
        index.setdefault(path.stem.casefold(), []).append(path)
    for values in index.values():
        values.sort(key=lambda item: item.name.casefold())
    return index


def make_plan(source: Path, destination: Path, identifiers: list[str], recursive: bool) -> list[PlanItem]:
    """根据来源目录和目标目录生成可审阅的移动计划。"""

    index = scan_image_files(source, destination, recursive)
    destination_names: set[str] = set()
    if destination.exists():
        destination_names = {
            path.name.casefold()
            for path in destination.iterdir()
            if path.is_file()
        }

    plan: list[PlanItem] = []
    for identifier in identifiers:
        matches = list(index.get(identifier.casefold(), []))
        movable = [path for path in matches if path.name.casefold() not in destination_names]
        conflicts = [path for path in matches if path.name.casefold() in destination_names]
        if not matches:
            status = "未找到"
        elif conflicts and movable:
            status = f"部分可移动 · {len(movable)}/{len(matches)}"
        elif conflicts:
            status = "目标已存在"
        elif len(movable) > 1:
            status = f"可移动 · {len(movable)} 个文件"
        else:
            status = "可移动"
        plan.append(PlanItem(identifier, matches, movable, conflicts, status))
    return plan


class ModelImageSorter:
    """Tkinter GUI。扫描和移动在后台线程执行，避免大目录阻塞窗口。"""

    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title("模特图 ID 分类器")
        self.root.geometry("980x700")
        self.root.minsize(760, 560)
        self.root.configure(bg="#eef1f4")

        self.source_var = StringVar(value=str(Path.cwd()))
        self.destination_var = StringVar()
        self.recursive_var = BooleanVar(value=False)
        self.summary_var = StringVar(value="请粘贴 ID 后扫描")
        self.status_var = StringVar(value="就绪")

        self.plan: list[PlanItem] = []
        self.plan_source: Path | None = None
        self.plan_destination: Path | None = None
        self.plan_identifiers: list[str] = []
        self.invalid_ids: list[str] = []
        self.last_moves: list[tuple[Path, Path]] = []
        self.busy = False

        self._configure_style()
        self._build_ui()

    def _configure_style(self) -> None:
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure("App.TFrame", background="#eef1f4")
        style.configure("Card.TFrame", background="#ffffff")
        style.configure("Title.TLabel", background="#eef1f4", foreground="#1f2937", font=("Segoe UI", 22, "bold"))
        style.configure("Subtitle.TLabel", background="#eef1f4", foreground="#6b7280", font=("Segoe UI", 10))
        style.configure("CardTitle.TLabel", background="#ffffff", foreground="#1f2937", font=("Segoe UI", 12, "bold"))
        style.configure("Muted.TLabel", background="#ffffff", foreground="#6b7280", font=("Segoe UI", 9))
        style.configure("Status.TLabel", background="#eef1f4", foreground="#596579", font=("Segoe UI", 9))
        style.configure("Primary.TButton", padding=(14, 8), foreground="#ffffff", background="#2563eb", font=("Segoe UI", 10, "bold"))
        style.map("Primary.TButton", background=[("active", "#1d4ed8"), ("disabled", "#a8b7d6")])
        style.configure("Soft.TButton", padding=(11, 7), foreground="#25324a", background="#f6f8fb")
        style.map("Soft.TButton", background=[("active", "#e9eef8")])
        style.configure("Treeview", rowheight=30, font=("Segoe UI", 9), background="#ffffff", fieldbackground="#ffffff", foreground="#25324a")
        style.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"), background="#f3f5f8", foreground="#48566c")
        style.map("Treeview", background=[("selected", "#dce8ff")], foreground=[("selected", "#1f3f87")])

    def _build_ui(self) -> None:
        outer = ttk.Frame(self.root, style="App.TFrame", padding=18)
        outer.pack(fill="both", expand=True)

        ttk.Label(outer, text="模特图 ID 分类器", style="Title.TLabel").pack(anchor="w")
        ttk.Label(outer, text="按 ID 精确匹配图片，预览确认后批量移动到指定文件夹", style="Subtitle.TLabel").pack(anchor="w", pady=(2, 14))

        path_card = ttk.Frame(outer, style="Card.TFrame", padding=14)
        path_card.pack(fill="x", pady=(0, 10))
        ttk.Label(path_card, text="目录设置", style="CardTitle.TLabel").grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 10))
        ttk.Label(path_card, text="图片来源文件夹", style="Muted.TLabel").grid(row=1, column=0, sticky="w", padx=(0, 10), pady=4)
        self.source_entry = ttk.Entry(path_card, textvariable=self.source_var)
        self.source_entry.grid(row=1, column=1, sticky="ew", pady=4)
        ttk.Button(path_card, text="选择…", style="Soft.TButton", command=self.choose_source).grid(row=1, column=2, padx=(8, 0), pady=4)
        ttk.Label(path_card, text="输出文件夹", style="Muted.TLabel").grid(row=2, column=0, sticky="w", padx=(0, 10), pady=4)
        self.destination_entry = ttk.Entry(path_card, textvariable=self.destination_var)
        self.destination_entry.grid(row=2, column=1, sticky="ew", pady=4)
        ttk.Button(path_card, text="选择…", style="Soft.TButton", command=self.choose_destination).grid(row=2, column=2, padx=(8, 0), pady=4)
        ttk.Checkbutton(path_card, text="递归扫描来源文件夹内的子文件夹", variable=self.recursive_var, command=self.clear_plan).grid(row=3, column=1, sticky="w", pady=(8, 0))
        path_card.columnconfigure(1, weight=1)

        content = ttk.Frame(outer, style="App.TFrame")
        content.pack(fill="both", expand=True)
        content.columnconfigure(0, weight=1, uniform="content")
        content.columnconfigure(1, weight=2, uniform="content")
        content.rowconfigure(0, weight=1)

        id_card = ttk.Frame(content, style="Card.TFrame", padding=14)
        id_card.grid(row=0, column=0, sticky="nsew", padx=(0, 5))
        ttk.Label(id_card, text="ID 清单", style="CardTitle.TLabel").pack(anchor="w")
        ttk.Label(id_card, text="每行一个 ID，可直接粘贴 50 个或更多。也支持粘贴 1234567.png。", style="Muted.TLabel", wraplength=280).pack(anchor="w", pady=(3, 8))
        text_frame = ttk.Frame(id_card, style="Card.TFrame")
        text_frame.pack(fill="both", expand=True)
        self.ids_text = Text(text_frame, height=16, width=30, wrap="none", undo=True, font=("Consolas", 10), bg="#fbfcfe", fg="#25324a", insertbackground="#2563eb", relief="flat", borderwidth=1, padx=8, pady=8)
        self.ids_text.pack(side="left", fill="both", expand=True)
        id_scroll = ttk.Scrollbar(text_frame, orient="vertical", command=self.ids_text.yview)
        id_scroll.pack(side="right", fill="y")
        self.ids_text.configure(yscrollcommand=id_scroll.set)
        id_buttons = ttk.Frame(id_card, style="Card.TFrame")
        id_buttons.pack(fill="x", pady=(9, 0))
        ttk.Button(id_buttons, text="粘贴剪贴板", style="Soft.TButton", command=self.paste_clipboard).pack(side="left")
        ttk.Button(id_buttons, text="清空", style="Soft.TButton", command=self.clear_ids).pack(side="left", padx=(6, 0))

        preview_card = ttk.Frame(content, style="Card.TFrame", padding=14)
        preview_card.grid(row=0, column=1, sticky="nsew", padx=(5, 0))
        top_line = ttk.Frame(preview_card, style="Card.TFrame")
        top_line.pack(fill="x")
        ttk.Label(top_line, text="匹配预览", style="CardTitle.TLabel").pack(side="left")
        ttk.Label(top_line, textvariable=self.summary_var, style="Muted.TLabel").pack(side="right")
        tree_frame = ttk.Frame(preview_card, style="Card.TFrame")
        tree_frame.pack(fill="both", expand=True, pady=(10, 0))
        columns = ("identifier", "status", "files")
        self.tree = ttk.Treeview(tree_frame, columns=columns, show="headings", selectmode="browse")
        self.tree.heading("identifier", text="ID")
        self.tree.heading("status", text="状态")
        self.tree.heading("files", text="匹配文件")
        self.tree.column("identifier", width=150, minwidth=100, anchor="w")
        self.tree.column("status", width=160, minwidth=120, anchor="w")
        self.tree.column("files", width=320, minwidth=180, anchor="w")
        self.tree.pack(side="left", fill="both", expand=True)
        tree_scroll = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        tree_scroll.pack(side="right", fill="y")
        self.tree.configure(yscrollcommand=tree_scroll.set)
        self.tree.tag_configure("ready", foreground="#166534")
        self.tree.tag_configure("warning", foreground="#9a6700")
        self.tree.tag_configure("missing", foreground="#8a94a6")
        self.tree.tag_configure("done", foreground="#1d4ed8")
        self.tree.tag_configure("error", foreground="#b42318")

        actions = ttk.Frame(outer, style="App.TFrame")
        actions.pack(fill="x", pady=(12, 0))
        self.scan_button = ttk.Button(actions, text="扫描匹配", style="Primary.TButton", command=self.scan)
        self.scan_button.pack(side="left")
        self.move_button = ttk.Button(actions, text="确认移动", style="Primary.TButton", command=self.confirm_move, state=DISABLED)
        self.move_button.pack(side="left", padx=(8, 0))
        self.undo_button = ttk.Button(actions, text="撤销上次移动", style="Soft.TButton", command=self.confirm_undo, state=DISABLED)
        self.undo_button.pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="关闭", style="Soft.TButton", command=self.root.destroy).pack(side="right")
        ttk.Label(actions, textvariable=self.status_var, style="Status.TLabel").pack(side="left", padx=(14, 0))

    def choose_source(self) -> None:
        folder = filedialog.askdirectory(title="选择图片来源文件夹", initialdir=self.source_var.get() or str(Path.cwd()))
        if folder:
            self.source_var.set(folder)
            if not self.destination_var.get().strip():
                self.destination_var.set(str(Path(folder) / "已分类"))
            self.clear_plan()

    def choose_destination(self) -> None:
        folder = filedialog.askdirectory(title="选择输出文件夹", initialdir=self.destination_var.get() or self.source_var.get() or str(Path.cwd()))
        if folder:
            self.destination_var.set(folder)
            self.clear_plan()

    def paste_clipboard(self) -> None:
        try:
            clipboard = self.root.clipboard_get()
        except Exception:
            messagebox.showwarning("无法粘贴", "剪贴板中没有可读取的文本。", parent=self.root)
            return
        self.ids_text.insert("insert", clipboard)
        self.clear_plan()

    def clear_ids(self) -> None:
        self.ids_text.delete("1.0", END)
        self.clear_plan()

    def clear_plan(self) -> None:
        if self.busy:
            return
        self.plan = []
        self.plan_source = None
        self.plan_destination = None
        self.plan_identifiers = []
        self.invalid_ids = []
        self.summary_var.set("请扫描匹配结果")
        self.move_button.configure(state=DISABLED)
        for item in self.tree.get_children():
            self.tree.delete(item)

    def _set_busy(self, busy: bool, status: str) -> None:
        self.busy = busy
        self.status_var.set(status)
        state = DISABLED if busy else NORMAL
        self.scan_button.configure(state=state)
        self.source_entry.configure(state=state)
        self.destination_entry.configure(state=state)
        self.move_button.configure(state=DISABLED if busy else self.move_button_state())
        self.undo_button.configure(state=DISABLED if busy else (NORMAL if self.last_moves else DISABLED))

    def move_button_state(self) -> str:
        return NORMAL if any(item.movable for item in self.plan) else DISABLED

    def _read_inputs(self) -> tuple[Path, Path, list[str], list[str]]:
        source_text = self.source_var.get().strip()
        destination_text = self.destination_var.get().strip()
        if not source_text:
            raise ValueError("请选择图片来源文件夹")
        if not destination_text:
            raise ValueError("请选择输出文件夹")
        source = Path(source_text).expanduser()
        destination = Path(destination_text).expanduser()
        if not source.is_dir():
            raise ValueError(f"来源文件夹不存在：{source}")
        if destination.exists() and not destination.is_dir():
            raise ValueError(f"输出路径不是文件夹：{destination}")
        if source.resolve() == destination.resolve():
            raise ValueError("输出文件夹不能与来源文件夹相同")
        identifiers, invalid = parse_ids(self.ids_text.get("1.0", END))
        if not identifiers:
            raise ValueError("没有读取到有效 ID")
        return source, destination, identifiers, invalid

    def scan(self) -> None:
        if self.busy:
            return
        try:
            source, destination, identifiers, invalid = self._read_inputs()
        except ValueError as error:
            messagebox.showwarning("无法扫描", str(error), parent=self.root)
            return

        self.clear_plan()
        self._set_busy(True, "正在扫描图片文件…")
        recursive = self.recursive_var.get()
        threading.Thread(target=self._scan_worker, args=(source, destination, identifiers, invalid, recursive), daemon=True).start()

    def _scan_worker(self, source: Path, destination: Path, identifiers: list[str], invalid: list[str], recursive: bool) -> None:
        try:
            plan = make_plan(source, destination, identifiers, recursive)
            self.root.after(0, self._scan_done, source, destination, identifiers, invalid, plan, None)
        except Exception as error:  # pragma: no cover - 由 GUI 显示具体错误
            self.root.after(0, self._scan_done, source, destination, identifiers, invalid, [], error)

    def _scan_done(self, source: Path, destination: Path, identifiers: list[str], invalid: list[str], plan: list[PlanItem], error: Exception | None) -> None:
        self._set_busy(False, "扫描完成" if error is None else "扫描失败")
        if error is not None:
            messagebox.showerror("扫描失败", str(error), parent=self.root)
            return
        self.plan = plan
        self.plan_source = source
        self.plan_destination = destination
        self.plan_identifiers = identifiers
        self.invalid_ids = invalid
        self._render_plan()
        if invalid:
            self.status_var.set(f"扫描完成，另有 {len(invalid)} 个粘贴值格式无效")

    def _render_plan(self) -> None:
        for item in self.tree.get_children():
            self.tree.delete(item)
        movable_ids = 0
        movable_files = 0
        missing = 0
        conflicts = 0
        duplicate_files = 0
        for item in self.plan:
            if item.movable:
                movable_ids += 1
                movable_files += len(item.movable)
            if not item.matches:
                missing += 1
            if item.conflicts:
                conflicts += len(item.conflicts)
            if len(item.matches) > 1:
                duplicate_files += len(item.matches)
            display_files = ", ".join(path.name for path in item.matches[:3])
            if len(item.matches) > 3:
                display_files += f" 等 {len(item.matches)} 个文件"
            if item.status.startswith("可移动") or item.status.startswith("部分可移动"):
                tag = "ready"
            elif item.status == "未找到":
                tag = "missing"
            elif item.status == "已移动":
                tag = "done"
            elif item.status.startswith("失败"):
                tag = "error"
            else:
                tag = "warning"
            self.tree.insert("", END, values=(item.identifier, item.status, display_files or "—"), tags=(tag,))
        destination_note = "目标目录不存在，确认移动时会创建" if self.plan_destination and not self.plan_destination.exists() else ""
        duplicate_note = f" · {duplicate_files} 个重复匹配" if duplicate_files else ""
        self.summary_var.set(
            f"{len(self.plan)} 个 ID · {movable_ids} 个可移动 · {movable_files} 个文件 · "
            f"{missing} 个未找到 · {conflicts} 个冲突{duplicate_note}"
            + (f" · {destination_note}" if destination_note else "")
        )
        self.move_button.configure(state=self.move_button_state())

    def _plan_is_current(self) -> bool:
        try:
            source, destination, identifiers, _invalid = self._read_inputs()
        except ValueError:
            return False
        return source == self.plan_source and destination == self.plan_destination and identifiers == self.plan_identifiers

    def confirm_move(self) -> None:
        if self.busy or not self.plan:
            return
        if not self._plan_is_current():
            messagebox.showwarning("需要重新扫描", "来源目录、输出目录或 ID 清单已经改变，请重新扫描匹配结果。", parent=self.root)
            return
        files = [path for item in self.plan for path in item.movable]
        if not files:
            messagebox.showinfo("没有可移动文件", "没有找到可以移动的图片；请检查未找到或目标已存在的项目。", parent=self.root)
            return
        destination = self.plan_destination
        assert destination is not None
        text = f"确认移动 {len(files)} 个图片文件到：\n{destination}\n\n目标目录中已有同名文件会跳过，不会覆盖。"
        if not messagebox.askyesno("确认移动", text, icon="question", parent=self.root):
            return
        self._set_busy(True, "正在移动文件…")
        threading.Thread(target=self._move_worker, args=(self.plan, destination), daemon=True).start()

    def _move_worker(self, plan: list[PlanItem], destination: Path) -> None:
        moved: list[tuple[Path, Path]] = []
        skipped: list[tuple[Path, str]] = []
        failed: list[tuple[Path, str]] = []
        try:
            destination.mkdir(parents=True, exist_ok=True)
            for item in plan:
                for source in item.movable:
                    target = destination / source.name
                    if not source.exists():
                        failed.append((source, "来源文件已不存在"))
                        continue
                    if target.exists():
                        skipped.append((source, "目标已存在"))
                        continue
                    try:
                        shutil.move(str(source), str(target))
                        moved.append((source, target))
                    except OSError as error:
                        failed.append((source, str(error)))
            self.root.after(0, self._move_done, moved, skipped, failed, None)
        except Exception as error:  # pragma: no cover - 由 GUI 显示具体错误
            self.root.after(0, self._move_done, moved, skipped, failed, error)

    def _move_done(self, moved: list[tuple[Path, Path]], skipped: list[tuple[Path, str]], failed: list[tuple[Path, str]], error: Exception | None) -> None:
        self._set_busy(False, "移动完成" if error is None else "移动失败")
        if error is not None:
            messagebox.showerror("移动失败", str(error), parent=self.root)
            return
        self.last_moves = moved
        for item in self.plan:
            original_movable = list(item.movable)
            item_moved = [pair for pair in moved if pair[0] in original_movable]
            item_failed = [pair for pair in failed if pair[0] in original_movable]
            item_skipped = [pair for pair in skipped if pair[0] in original_movable]
            moved_sources = {pair[0] for pair in item_moved}
            item.movable = [path for path in original_movable if path not in moved_sources]
            if item_moved and not item_failed and not item_skipped and not item.conflicts:
                item.status = "已移动"
            elif item_moved:
                item.status = f"已移动 · {len(item_moved)} 个"
            elif item_skipped:
                item.status = "跳过 · 目标已存在"
            elif item_failed:
                item.status = "失败"
        self._render_plan()
        if self.plan_destination is not None:
            log_path = self.plan_destination / f"model-image-sorter-{datetime.now():%Y%m%d-%H%M%S}.log"
            try:
                lines = [f"移动时间：{datetime.now():%Y-%m-%d %H:%M:%S}", f"移动成功：{len(moved)}", f"跳过：{len(skipped)}", f"失败：{len(failed)}", ""]
                lines.extend(f"已移动\t{source}\t=>\t{target}" for source, target in moved)
                lines.extend(f"跳过\t{source}\t{reason}" for source, reason in skipped)
                lines.extend(f"失败\t{source}\t{reason}" for source, reason in failed)
                log_path.write_text("\n".join(lines), encoding="utf-8")
            except OSError:
                log_path = None
            self.undo_button.configure(state=NORMAL if moved else DISABLED)
            log_note = f"，日志：{log_path.name}" if log_path else ""
        else:
            log_note = ""
        self.status_var.set(f"已移动 {len(moved)} 个，跳过 {len(skipped)} 个，失败 {len(failed)} 个{log_note}")

    def confirm_undo(self) -> None:
        if self.busy or not self.last_moves:
            return
        if not messagebox.askyesno("撤销上次移动", f"确认把上次移动成功的 {len(self.last_moves)} 个文件移回原目录吗？\n\n如果原位置已有同名文件，将跳过。", parent=self.root):
            return
        self._set_busy(True, "正在撤销上次移动…")
        moves = list(self.last_moves)
        threading.Thread(target=self._undo_worker, args=(moves,), daemon=True).start()

    def _undo_worker(self, moves: list[tuple[Path, Path]]) -> None:
        restored = 0
        skipped = 0
        failed: list[str] = []
        for original, current in moves:
            if not current.exists():
                failed.append(f"{current}：文件不存在")
                continue
            if original.exists():
                skipped += 1
                continue
            try:
                original.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(current), str(original))
                restored += 1
            except OSError as error:
                failed.append(f"{current}：{error}")
        self.root.after(0, self._undo_done, restored, skipped, failed)

    def _undo_done(self, restored: int, skipped: int, failed: list[str]) -> None:
        self._set_busy(False, "撤销完成")
        if restored:
            self.last_moves = []
            self.undo_button.configure(state=DISABLED)
        self.status_var.set(f"已移回 {restored} 个，跳过 {skipped} 个，失败 {len(failed)} 个")
        if failed:
            messagebox.showwarning("撤销结果", "以下文件未能移回：\n\n" + "\n".join(failed[:20]), parent=self.root)


def main() -> None:
    try:
        root = Tk()
    except TclError as error:
        print("无法启动图形界面：当前 Python 没有可用的 Tcl/Tk 组件。", file=sys.stderr)
        print("请安装 python.org 的 Windows Python，并勾选 Tcl/Tk（通常随官方安装包提供）。", file=sys.stderr)
        print(f"详细信息：{error}", file=sys.stderr)
        raise SystemExit(1) from error
    ModelImageSorter(root)
    root.mainloop()


if __name__ == "__main__":
    main()
