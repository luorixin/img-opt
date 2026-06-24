"""Celery 任务函数的资源清理回归测试。"""

import pytest

from img_cleaner_backend import tasks


def test_inpaint_task_deletes_input_when_reading_fails(monkeypatch):
    """输入读取异常也必须释放活动租约和任务目录。"""

    class FailingStorage:
        def __init__(self):
            self.deleted = []

        def mark_active(self, input_id):
            assert input_id == "task-1"

        def read_input(self, input_id):
            raise OSError("input disappeared")

        def delete_input(self, input_id):
            self.deleted.append(input_id)

    storage = FailingStorage()
    monkeypatch.setattr(tasks, "build_task_file_storage_from_env", lambda: storage)
    monkeypatch.setattr(tasks.inpaint_task, "update_state", lambda **kwargs: None)

    with pytest.raises(OSError, match="input disappeared"):
        tasks.inpaint_task.run("task-1", 0, 0)

    assert storage.deleted == ["task-1"]
