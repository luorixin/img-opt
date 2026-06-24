from pathlib import Path
import os

from img_cleaner_backend.task_storage import TaskFileStorage


def test_task_file_storage_writes_inputs_and_result_outside_celery_messages(tmp_path):
    storage = TaskFileStorage(tmp_path)

    stored_input = storage.create_input(b"image-bytes", b"mask-bytes")

    assert stored_input.input_id
    assert stored_input.image_path != stored_input.mask_path
    assert Path(stored_input.image_path).read_bytes() == b"image-bytes"
    assert Path(stored_input.mask_path).read_bytes() == b"mask-bytes"
    assert storage.read_input(stored_input.input_id) == (b"image-bytes", b"mask-bytes")

    result_path = storage.write_result("task-1", b"png-result")

    assert storage.read_result(result_path) == b"png-result"


def test_task_file_storage_rejects_path_traversal(tmp_path):
    storage = TaskFileStorage(tmp_path)

    try:
        storage.read_input("../outside")
    except ValueError as exc:
        assert str(exc) == "Invalid task artifact id."
    else:
        raise AssertionError("Expected invalid artifact id to be rejected")


def test_task_file_storage_cleans_expired_artifacts(tmp_path):
    storage = TaskFileStorage(tmp_path)
    old_input = tmp_path / "abc123"
    old_input.mkdir()
    (old_input / "image.png").write_bytes(b"old")
    (old_input / "mask.png").write_bytes(b"old")
    old_result_dir = tmp_path / "results"
    old_result_dir.mkdir()
    old_result = old_result_dir / "task-1.png"
    old_result.write_bytes(b"old-result")
    fresh_result = old_result_dir / "task-2.png"
    fresh_result.write_bytes(b"fresh-result")

    old_time = 1_000
    fresh_time = 2_000
    os.utime(old_input, (old_time, old_time))
    os.utime(old_result, (old_time, old_time))
    os.utime(fresh_result, (fresh_time, fresh_time))

    storage.cleanup_expired(max_age_seconds=500, now=2_000)

    assert not old_input.exists()
    assert not old_result.exists()
    assert fresh_result.exists()


def test_task_storage_uses_requested_task_id_for_input_directory(tmp_path):
    """队列任务 ID 与输入目录一致，取消任务时才能定位并清理文件。"""
    storage = TaskFileStorage(tmp_path)

    stored = storage.create_input(b"image", b"mask", input_id="task-123")

    assert stored.input_id == "task-123"
    assert storage.input_exists("task-123") is True


def test_cleanup_keeps_recent_active_task_even_when_input_directory_is_old(tmp_path):
    """正在执行的任务使用活动租约保护，不应被普通输入 TTL 删除。"""
    storage = TaskFileStorage(tmp_path)
    stored = storage.create_input(b"image", b"mask", input_id="active-task")
    input_dir = Path(stored.image_path).parent
    os.utime(input_dir, (1_000, 1_000))

    storage.mark_active("active-task", now=1_900)
    storage.cleanup_expired(max_age_seconds=500, now=2_000)

    assert input_dir.exists()


def test_cancelled_task_marker_is_queryable_and_expires(tmp_path):
    """取消状态需要独立持久化，同时跟随任务结果 TTL 自动清理。"""
    storage = TaskFileStorage(tmp_path)
    storage.mark_cancelled("task-1", now=1_000)

    assert storage.is_cancelled("task-1") is True

    storage.cleanup_expired(max_age_seconds=500, now=2_000)

    assert storage.is_cancelled("task-1") is False
