"""
异步图像任务的文件存储模块。

上传内容和生成结果保存在共享目录中，Celery 消息只传递任务引用。
模块同时维护活动租约与取消标记，供清理器和状态接口判断任务生命周期。
"""
from __future__ import annotations

import os
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class StoredTaskInput:
    """记录一个任务输入目录及其中的图片、蒙版路径。"""

    input_id: str
    image_path: str
    mask_path: str


class TaskFileStorage:
    """管理任务输入、结果、活动租约和取消状态的共享文件存储。"""

    def __init__(self, root: str | os.PathLike[str] | None = None):
        """初始化共享根目录；未指定时使用系统临时目录。"""
        default_root = Path(tempfile.gettempdir()) / "img-cleaner-tasks"
        self.root = Path(root or os.getenv("TASK_STORAGE_DIR", default_root)).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def create_input(
        self,
        image_bytes: bytes,
        mask_bytes: bytes,
        input_id: str | None = None,
    ) -> StoredTaskInput:
        """原子写入任务输入，并允许调用方使用 Celery 任务 ID 命名目录。"""
        self.cleanup_expired()
        resolved_input_id = input_id or uuid.uuid4().hex
        directory = self._artifact_dir(resolved_input_id)
        directory.mkdir(parents=True, exist_ok=False)
        image_path = directory / "image.png"
        mask_path = directory / "mask.png"
        _atomic_write(image_path, image_bytes)
        _atomic_write(mask_path, mask_bytes)
        return StoredTaskInput(
            input_id=resolved_input_id,
            image_path=str(image_path),
            mask_path=str(mask_path),
        )

    def read_input(self, input_id: str) -> tuple[bytes, bytes]:
        """读取指定任务的原图和蒙版字节。"""
        directory = self._artifact_dir(input_id)
        return (directory / "image.png").read_bytes(), (directory / "mask.png").read_bytes()

    def delete_input(self, input_id: str) -> None:
        """删除任务输入目录；目录不存在时视为已经清理。"""
        shutil.rmtree(self._artifact_dir(input_id), ignore_errors=True)

    def input_exists(self, input_id: str) -> bool:
        """判断任务输入目录是否存在，用于区分未知 PENDING 任务。"""
        return self._artifact_dir(input_id).is_dir()

    def mark_active(self, input_id: str, now: float | None = None) -> None:
        """刷新活动租约，阻止常规输入 TTL 清理正在执行的任务。"""
        marker = self._artifact_dir(input_id) / ".active"
        marker.touch(exist_ok=True)
        timestamp = now if now is not None else time.time()
        os.utime(marker, (timestamp, timestamp))

    def mark_cancelled(self, task_id: str, now: float | None = None) -> None:
        """持久化取消状态，使状态查询不依赖 Celery 的异步回写。"""
        marker = self._status_marker(task_id)
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.touch(exist_ok=True)
        timestamp = now if now is not None else time.time()
        os.utime(marker, (timestamp, timestamp))

    def is_cancelled(self, task_id: str) -> bool:
        """判断任务是否已通过本服务发起取消。"""
        return self._status_marker(task_id).is_file()

    def write_result(self, task_id: str, image_bytes: bytes) -> str:
        """原子写入任务结果 PNG，并返回 Worker 与 API 共享的路径。"""
        self.cleanup_expired()
        if not _is_safe_id(task_id):
            raise ValueError("Invalid task artifact id.")
        result_dir = self.root / "results"
        result_dir.mkdir(parents=True, exist_ok=True)
        result_path = result_dir / f"{task_id}.png"
        _atomic_write(result_path, image_bytes)
        return str(result_path)

    def read_result(self, result_path: str) -> bytes:
        """校验结果路径位于共享根目录后读取内容。"""
        path = Path(result_path).resolve()
        if not path.is_file() or not _is_relative_to(path, self.root):
            raise ValueError("Invalid task artifact path.")
        return path.read_bytes()

    def cleanup_expired(self, max_age_seconds: int | None = None, now: float | None = None) -> None:
        """清理过期输入、结果和状态，同时保留具有新鲜活动租约的任务。"""
        current_time = now if now is not None else time.time()
        result_age = max_age_seconds if max_age_seconds is not None else _artifact_expiry_seconds()
        input_age = max_age_seconds if max_age_seconds is not None else _input_expiry_seconds()
        active_age = max_age_seconds if max_age_seconds is not None else _active_expiry_seconds()
        result_cutoff = current_time - result_age
        input_cutoff = current_time - input_age
        active_cutoff = current_time - active_age
        results_dir = self.root / "results"
        status_dir = self.root / "status"
        for child in self.root.iterdir():
            if child in {results_dir, status_dir}:
                continue
            try:
                active_marker = child / ".active"
                if active_marker.is_file() and active_marker.stat().st_mtime >= active_cutoff:
                    continue
                if child.is_dir() and child.stat().st_mtime < input_cutoff:
                    shutil.rmtree(child, ignore_errors=True)
            except FileNotFoundError:
                continue

        if results_dir.is_dir():
            for result_file in results_dir.glob("*.png"):
                try:
                    if result_file.stat().st_mtime < result_cutoff:
                        result_file.unlink(missing_ok=True)
                except FileNotFoundError:
                    continue

        if status_dir.is_dir():
            for status_file in status_dir.glob("*.cancelled"):
                try:
                    if status_file.stat().st_mtime < result_cutoff:
                        status_file.unlink(missing_ok=True)
                except FileNotFoundError:
                    continue

    def _artifact_dir(self, artifact_id: str) -> Path:
        """构造并校验输入目录路径，防止目录穿越。"""
        if not _is_safe_id(artifact_id):
            raise ValueError("Invalid task artifact id.")
        path = (self.root / artifact_id).resolve()
        if not _is_relative_to(path, self.root):
            raise ValueError("Invalid task artifact id.")
        return path

    def _status_marker(self, task_id: str) -> Path:
        """构造位于状态子目录中的安全取消标记路径。"""
        if not _is_safe_id(task_id):
            raise ValueError("Invalid task artifact id.")
        return self.root / "status" / f"{task_id}.cancelled"


def build_task_file_storage_from_env() -> TaskFileStorage:
    """根据环境变量创建任务文件存储。"""
    return TaskFileStorage()


def _artifact_expiry_seconds() -> int:
    """读取结果和取消标记的过期秒数。"""
    return int(
        os.getenv(
            "TASK_ARTIFACT_EXPIRES_SECONDS",
            os.getenv("CELERY_RESULT_EXPIRES_SECONDS", "3600"),
        )
    )


def _input_expiry_seconds() -> int:
    """读取排队输入过期秒数，默认长于结果 TTL。"""
    return int(os.getenv("TASK_INPUT_EXPIRES_SECONDS", "86400"))


def _active_expiry_seconds() -> int:
    """读取活动租约最大保留秒数，用于回收异常退出的 Worker 文件。"""
    return int(os.getenv("TASK_ACTIVE_EXPIRES_SECONDS", "86400"))


def _is_safe_id(value: str) -> bool:
    """仅允许字母、数字和连字符作为任务文件标识。"""
    return value.replace("-", "").isalnum()


def _is_relative_to(path: Path, parent: Path) -> bool:
    """兼容性判断路径是否位于指定父目录中。"""
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _atomic_write(path: Path, content: bytes) -> None:
    """先写入同目录唯一临时文件，再原子替换目标文件。"""
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
